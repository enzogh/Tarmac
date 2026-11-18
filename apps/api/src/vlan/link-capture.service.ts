import { forwardRef, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { AgentsService } from '../agents/agents.service';
import { extractExternalIp } from '../nodes/extract-external-ip';
import { alertKey } from '../alerts/alert-keys';
import { raiseAlert } from '../alerts/alert-lifecycle';
import { workspaceAlertRecipients } from '../mail/alert-recipients';
import { MailService } from '../mail/mail.service';
import { IncidentDirection, renderLinkIncident } from '../mail/templates/link-incident';
import type { PathTraceResult } from '../agents/agents.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildLinkReport,
  destinationLoss,
  outcomeLoss,
  pingLoss,
  ReportNode,
  StoredTraceOutcome,
  storedToOutcome,
  TraceOutcome,
} from './link-report';
import { LinkDegradedEvent, VlanService } from './vlan.service';

// What each server runs towards the other's public IP: mtr's usual report
// length and a 100-packet ping (20 s, alongside the MTR). ~32 s in all.
export const DIAGNOSTIC_MTR_CYCLES = 30;
export const DIAGNOSTIC_PING_COUNT = 100;

// One capture per link at most this often: an incident lasting hours still
// gets a capture every half hour, a flapping link doesn't flood the agents.
const CAPTURE_COOLDOWN_MS = 30 * 60_000;
// Links degrading together (one server's route failing towards several
// others) are captured a few at a time; the rest wait for their next
// transition.
const MAX_CONCURRENT_CAPTURES = 3;
// Statuses right after an API restart come from agents reconnecting.
const CAPTURE_STARTUP_GRACE_MS = 3 * 60_000;
const CAPTURE_RETENTION_DAYS = 7;
// History covered by the report mailed with an incident.
const INCIDENT_REPORT_WINDOW_MS = 6 * 3_600_000;

export type DiagnosticEndpoint = { id: string; publicIp: string | null };

type ReportableNode = {
  name: string;
  overlayEndpoint: string | null;
  locationCity: string | null;
  locationCountry: string | null;
};

/** A node as the hosting-provider report presents it. */
export function reportNodeFrom(node: ReportableNode): ReportNode {
  const port = Number((node.overlayEndpoint ?? '').match(/:(\d+)$/)?.[1]);
  return {
    name: node.name,
    publicIp: extractExternalIp(node.overlayEndpoint),
    tunnelPort: Number.isFinite(port) && port > 0 ? port : null,
    location: [node.locationCity, node.locationCountry].filter(Boolean).join(', ') || null,
  };
}

function incidentDirection(outcome: TraceOutcome): IncidentDirection {
  if (!outcome.ok) {
    return { pingLoss: null, pingAvgMs: null, mtrHops: null, reached: null, mtrDestLoss: null, cpuUsed: null, cpuSteal: null, failure: outcome.reason };
  }
  const trace: PathTraceResult = outcome.trace;
  const avg = trace.ping?.output.match(/= [\d.]+\/([\d.]+)\//);
  const cpu = trace.system?.cpu ?? null;
  return {
    pingLoss: pingLoss(trace),
    pingAvgMs: avg ? Number(avg[1]) : null,
    mtrHops: trace.hops.length || null,
    reached: trace.hops.length ? trace.reached : null,
    mtrDestLoss: destinationLoss(trace),
    cpuUsed: cpu ? Math.round((100 - cpu.id) * 10) / 10 : null,
    cpuSteal: cpu ? cpu.st : null,
    failure: null,
  };
}

/**
 * Runs, from both ends of a direct link, the tests hosting providers ask
 * for before escalating (load, ping, traceroute, MTR) - on demand for a
 * report, and automatically when a link starts losing packets, so a report
 * written the next day still has evidence from during the incident.
 */
@Injectable()
export class LinkCaptureService implements OnModuleInit {
  private readonly logger = new Logger(LinkCaptureService.name);
  private readonly bootedAt = Date.now();
  private readonly lastCaptureAt = new Map<string, number>();
  private readonly busyNodes = new Set<string>();
  private running = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly vlanService: VlanService,
    @Inject(forwardRef(() => AgentsService))
    private readonly agentsService: AgentsService,
    private readonly mailService: MailService,
  ) {}

  onModuleInit() {
    this.vlanService.onLinkDegraded((event) => {
      void this.captureOnDegradation(event).catch((error) =>
        this.logger.warn(`Link capture failed: ${error instanceof Error ? error.message : String(error)}`),
      );
    });
  }

  /** Both directions at once; a side that can't run says why. */
  async runDiagnostics(a: DiagnosticEndpoint, b: DiagnosticEndpoint): Promise<{ aToB: StoredTraceOutcome; bToA: StoredTraceOutcome }> {
    const run = async (from: DiagnosticEndpoint, to: DiagnosticEndpoint): Promise<StoredTraceOutcome> => {
      if (!to.publicIp) return { ok: false, error: 'unknown public IP' };
      const ranAt = new Date().toISOString();
      try {
        const trace = await this.agentsService.requestPathTrace(from.id, to.publicIp, DIAGNOSTIC_MTR_CYCLES, {
          pingCount: DIAGNOSTIC_PING_COUNT,
          withLoad: true,
        });
        return { ok: true, ranAt, trace };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    };
    const [aToB, bToA] = await Promise.all([run(a, b), run(b, a)]);
    return { aToB, bToA };
  }

  async listCaptures(vlanId: string, aId: string, bId: string, since: Date) {
    const [nodeAId, nodeBId] = [aId, bId].sort();
    return this.prisma.linkCapture.findMany({
      where: { vlanId, nodeAId, nodeBId, createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async captureOnDegradation(event: LinkDegradedEvent) {
    if (Date.now() - this.bootedAt < CAPTURE_STARTUP_GRACE_MS) return;
    const [nodeAId, nodeBId] = [event.sourceNodeId, event.targetNodeId].sort();
    const key = `${event.vlanId}:${nodeAId}:${nodeBId}`;
    const last = this.lastCaptureAt.get(key) ?? 0;
    if (Date.now() - last < CAPTURE_COOLDOWN_MS) return;
    if (this.running >= MAX_CONCURRENT_CAPTURES || this.busyNodes.has(nodeAId) || this.busyNodes.has(nodeBId)) return;
    if (!this.agentsService.isConnected(nodeAId) || !this.agentsService.isConnected(nodeBId)) return;

    // Claimed before anything async: both directions report the same
    // degradation within seconds.
    this.lastCaptureAt.set(key, Date.now());
    this.running++;
    this.busyNodes.add(nodeAId);
    this.busyNodes.add(nodeBId);
    try {
      // The cooldown survives API restarts.
      const recent = await this.prisma.linkCapture.findFirst({
        where: { vlanId: event.vlanId, nodeAId, nodeBId, createdAt: { gte: new Date(Date.now() - CAPTURE_COOLDOWN_MS) } },
        select: { createdAt: true },
      });
      if (recent) {
        this.lastCaptureAt.set(key, recent.createdAt.getTime());
        return;
      }
      const nodes = await this.prisma.node.findMany({
        where: { id: { in: [nodeAId, nodeBId] } },
        select: { id: true, name: true, overlayEndpoint: true },
      });
      const endpoint = (id: string): DiagnosticEndpoint => ({
        id,
        publicIp: extractExternalIp(nodes.find((node) => node.id === id)?.overlayEndpoint ?? null),
      });
      const a = endpoint(nodeAId);
      const b = endpoint(nodeBId);
      if (!a.publicIp || !b.publicIp) return;

      const { aToB, bToA } = await this.runDiagnostics(a, b);
      if (!aToB.ok && !bToA.ok) {
        this.logger.warn(`Link capture ${key}: neither side could run (${aToB.error}; ${bToA.error})`);
        return;
      }
      const capture = await this.prisma.linkCapture.create({
        data: {
          vlanId: event.vlanId,
          nodeAId,
          nodeBId,
          triggerSourceId: event.sourceNodeId,
          triggerStatus: event.status,
          triggerLoss: event.packetLoss,
          triggerLatency: event.latencyMs,
          aToB: aToB as unknown as Prisma.InputJsonValue,
          bToA: bToA as unknown as Prisma.InputJsonValue,
        },
      });
      const names = new Map(nodes.map((node) => [node.id, node.name]));
      this.logger.log(
        `Captured link tests ${names.get(event.sourceNodeId)} -> ${names.get(event.targetNodeId)} (${event.status}, loss ${event.packetLoss ?? '?'}%)`,
      );
      // Seen from the side that noticed the loss.
      const forward = event.sourceNodeId === nodeAId;
      await this.reportIncident(event, capture.createdAt, forward ? aToB : bToA, forward ? bToA : aToB);
    } finally {
      this.running--;
      this.busyNodes.delete(nodeAId);
      this.busyNodes.delete(nodeBId);
    }
  }

  /**
   * Opens the "link degraded" alert and mails it with the captured tests
   * and the report for the hosting provider - once per incident: while the
   * alert is open, later captures only feed the report. A blip the link
   * already recovered from, with nothing lost during the tests, is left out.
   */
  private async reportIncident(event: LinkDegradedEvent, capturedAt: Date, out: StoredTraceOutcome, back: StoredTraceOutcome) {
    const { vlanId, sourceNodeId, targetNodeId } = event;
    const outcomeOut = storedToOutcome(out, 'fr');
    const outcomeBack = storedToOutcome(back, 'fr');
    const links = await this.prisma.vlanConnection.findMany({
      where: {
        vlanId,
        OR: [
          { sourceNodeId, targetNodeId },
          { sourceNodeId: targetNodeId, targetNodeId: sourceNodeId },
        ],
      },
      select: { status: true },
    });
    const stillFailing = links.some((link) => link.status === 'degraded' || link.status === 'offline');
    if (!stillFailing && !((outcomeLoss(outcomeOut, outcomeBack) ?? 0) > 0)) return;

    const since = new Date(capturedAt.getTime() - INCIDENT_REPORT_WINDOW_MS);
    const [vlan, data] = await Promise.all([
      this.prisma.vlan.findUnique({
        where: { id: vlanId },
        select: { workspace: { select: { id: true, name: true, slug: true, firewallPublicPing: true } } },
      }),
      this.vlanService.linkReportData(vlanId, sourceNodeId, targetNodeId, since),
    ]);
    if (!vlan?.workspace || !data.a || !data.b) return;
    const workspace = vlan.workspace;
    const a = reportNodeFrom(data.a);
    const b = reportNodeFrom(data.b);

    const fingerprint = alertKey.linkDegraded(vlanId, sourceNodeId, targetNodeId);
    const offline = event.status === 'offline';
    const loss = event.packetLoss === null ? '' : `, ${Math.round(event.packetLoss * 10) / 10} % de perte mesurée (${a.name} → ${b.name})`;
    const created = await raiseAlert(this.prisma, {
      workspaceId: workspace.id,
      fingerprint,
      nodeId: sourceNodeId,
      severity: offline ? 'high' : 'medium',
      message: `${offline ? 'Lien coupé' : 'Lien dégradé'} : ${a.name} ↔ ${b.name}${loss}. Tests top, ping, traceroute et MTR capturés depuis les deux serveurs ; rapport pour l’hébergeur envoyé par e-mail et disponible dans Réseau privé.`,
    });
    if (!created) return;
    this.logger.warn(`Link incident reported: ${a.name} <-> ${b.name} (${event.status})`);

    // Without a relay the alert digest marks it as handled.
    if (!this.mailService.isConfigured) return;
    const alert = await this.prisma.alert.findFirst({
      where: { fingerprint, status: { not: 'resolved' } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    const markNotified = () =>
      alert ? this.prisma.alert.update({ where: { id: alert.id }, data: { emailNotifiedAt: new Date() } }) : Promise.resolve();
    const recipients = await workspaceAlertRecipients(this.prisma, workspace.id);
    if (recipients.length === 0) {
      await markNotified();
      return;
    }

    const report = (lang: 'fr' | 'en') =>
      buildLinkReport({
        lang,
        generatedAt: capturedAt,
        since,
        a,
        b,
        aToB: data.aToB,
        bToA: data.bToA,
        aOthers: data.aOthers,
        bOthers: data.bOthers,
        // These are the tests of this very moment.
        traceAToB: storedToOutcome(out, lang),
        traceBToA: storedToOutcome(back, lang),
        captures: [],
        testsAreCapture: true,
        publicPingFiltered: workspace.firewallPublicPing === false,
      });
    const attachments = [report('fr'), report('en')].map(({ text, filename }) => ({ filename, content: text }));

    let delivered = 0;
    for (const recipient of recipients) {
      const mail = renderLinkIncident({
        workspaceName: workspace.name,
        workspaceSlug: workspace.slug,
        recipient,
        frontendUrl: this.mailService.frontendUrl,
        a,
        b,
        status: event.status,
        triggerLoss: event.packetLoss,
        triggerLatencyMs: event.latencyMs,
        capturedAt,
        aToB: incidentDirection(outcomeOut),
        bToA: incidentDirection(outcomeBack),
        attachments,
      });
      try {
        await this.mailService.send(recipient, mail);
        delivered++;
      } catch (error) {
        this.logger.warn(`Link incident email to ${recipient} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    // Nobody reached: the digest retries with the plain alert.
    if (delivered > 0) await markNotified();
  }

  @Cron('25 3 * * *')
  async pruneOldCaptures() {
    const cutoff = new Date(Date.now() - CAPTURE_RETENTION_DAYS * 24 * 3_600_000);
    const { count } = await this.prisma.linkCapture.deleteMany({ where: { createdAt: { lt: cutoff } } });
    if (count > 0) this.logger.log(`Pruned ${count} link capture(s)`);
  }
}
