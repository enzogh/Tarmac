import { forwardRef, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
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
  pingLoss,
  ReportNode,
  StoredTraceOutcome,
  storedToOutcome,
  TraceOutcome,
} from './link-report';
import {
  captureVerdict,
  INCIDENT_OBSERVE_MS,
  isLinkIncident,
  LinkStatusSample,
  linkDegradedNodes,
  unhealthyDurationMs,
} from './link-incident-policy';
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
// The observation starts a little before the capture: its tests take ~30 s
// after the status change that triggered them.
const INCIDENT_LOOKBACK_MS = 60_000;
// How far back to look for the status each direction had when the
// observation opened (a sample is written at least every 30 s per link).
const STATUS_SEED_MS = 10 * 60_000;

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
export class LinkCaptureService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LinkCaptureService.name);
  private readonly bootedAt = Date.now();
  private readonly lastCaptureAt = new Map<string, number>();
  private readonly busyNodes = new Set<string>();
  private readonly incidentChecks = new Set<NodeJS.Timeout>();
  // Incident checks run one at a time: two links of the same server must
  // see each other's alert to send a single email.
  private incidentQueue: Promise<void> = Promise.resolve();
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
    // Captures still under observation when the API restarted.
    void this.prisma.linkCapture
      .findMany({ where: { createdAt: { gt: new Date(Date.now() - INCIDENT_OBSERVE_MS) } }, select: { id: true, createdAt: true } })
      .then((captures) => captures.forEach((capture) => this.scheduleIncidentCheck(capture.id, capture.createdAt)))
      .catch((error) => this.logger.warn(`Pending link incident checks not restored: ${error instanceof Error ? error.message : String(error)}`));
  }

  onModuleDestroy() {
    for (const timer of this.incidentChecks) clearTimeout(timer);
    this.incidentChecks.clear();
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
      this.scheduleIncidentCheck(capture.id, capture.createdAt);
    } finally {
      this.running--;
      this.busyNodes.delete(nodeAId);
      this.busyNodes.delete(nodeBId);
    }
  }

  /** Decides on the incident once the link has been watched for a while. */
  private scheduleIncidentCheck(captureId: string, capturedAt: Date) {
    const delay = Math.max(0, capturedAt.getTime() + INCIDENT_OBSERVE_MS - Date.now());
    const timer = setTimeout(() => {
      this.incidentChecks.delete(timer);
      this.incidentQueue = this.incidentQueue
        .then(() => this.checkIncident(captureId))
        .catch((error) =>
          this.logger.warn(`Link incident check failed: ${error instanceof Error ? error.message : String(error)}`),
        );
    }, delay);
    this.incidentChecks.add(timer);
  }

  /**
   * A capture becomes an incident (alert, then email) only if the link
   * stayed degraded through most of the observation and the captured tests
   * lost packets themselves - see link-incident-policy. Anything less was a
   * blip: the capture stays available for the report, nobody is paged.
   */
  private async checkIncident(captureId: string) {
    const capture = await this.prisma.linkCapture.findUnique({ where: { id: captureId } });
    if (!capture) return;
    const sourceNodeId = capture.triggerSourceId;
    const targetNodeId = sourceNodeId === capture.nodeAId ? capture.nodeBId : capture.nodeAId;
    const from = new Date(capture.createdAt.getTime() - INCIDENT_LOOKBACK_MS);
    // A window of exactly INCIDENT_OBSERVE_MS, closed a minute before the
    // check runs so its last samples are in.
    const to = new Date(from.getTime() + INCIDENT_OBSERVE_MS);

    const [rows, workspace] = await Promise.all([
      this.prisma.vlanConnectionSample.findMany({
        where: {
          vlanId: capture.vlanId,
          OR: [
            { sourceNodeId, targetNodeId },
            { sourceNodeId: targetNodeId, targetNodeId: sourceNodeId },
          ],
          createdAt: { gte: new Date(from.getTime() - STATUS_SEED_MS), lt: to },
        },
        select: { sourceNodeId: true, status: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.vlan
        .findUnique({ where: { id: capture.vlanId }, select: { workspace: { select: { firewallPublicPing: true } } } })
        .then((vlan) => vlan?.workspace ?? null),
    ]);
    // Only the last status before the window counts as its opening state.
    const samples: LinkStatusSample[] = [];
    const seeded = new Set<string>();
    for (const row of [...rows].reverse()) {
      if (row.createdAt < from) {
        if (seeded.has(row.sourceNodeId)) continue;
        seeded.add(row.sourceNodeId);
      }
      samples.push({ sourceNodeId: row.sourceNodeId, status: row.status, at: row.createdAt });
    }
    const unhealthyMs = unhealthyDurationMs(samples, from, to);

    // Seen from the side that noticed the loss.
    const forward = sourceNodeId === capture.nodeAId;
    const aToB = capture.aToB as unknown as StoredTraceOutcome;
    const bToA = capture.bToA as unknown as StoredTraceOutcome;
    const out = forward ? aToB : bToA;
    const back = forward ? bToA : aToB;
    const verdict = captureVerdict([storedToOutcome(out, 'fr'), storedToOutcome(back, 'fr')], workspace?.firewallPublicPing === false);
    const minutes = Math.round(unhealthyMs / 6_000) / 10;
    if (!isLinkIncident(unhealthyMs, verdict)) {
      this.logger.log(`Link ${capture.vlanId}:${capture.nodeAId}:${capture.nodeBId}: blip, no incident (degraded ${minutes} min, tests ${verdict})`);
      return;
    }

    const event: LinkDegradedEvent = {
      vlanId: capture.vlanId,
      sourceNodeId,
      targetNodeId,
      status: capture.triggerStatus === 'offline' ? 'offline' : 'degraded',
      packetLoss: capture.triggerLoss,
      latencyMs: capture.triggerLatency,
    };
    await this.reportIncident(event, capture.createdAt, out, back, unhealthyMs);
  }

  /**
   * Opens the "link degraded" alert and mails it with the captured tests
   * and the report for the hosting provider - once per incident: while the
   * alert is open, later captures only feed the report. A server losing
   * packets towards several others is one incident: the links after the
   * first get their alert, not another email.
   */
  private async reportIncident(
    event: LinkDegradedEvent,
    capturedAt: Date,
    out: StoredTraceOutcome,
    back: StoredTraceOutcome,
    unhealthyMs: number,
  ) {
    const { vlanId, sourceNodeId, targetNodeId } = event;
    const outcomeOut = storedToOutcome(out, 'fr');
    const outcomeBack = storedToOutcome(back, 'fr');

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
    const duration = `, dégradé ${Math.max(1, Math.round(unhealthyMs / 60_000))} min sur ${Math.round(INCIDENT_OBSERVE_MS / 60_000)}`;
    const sibling = await this.emailedSiblingIncident(vlanId, sourceNodeId, targetNodeId);
    const created = await raiseAlert(this.prisma, {
      workspaceId: workspace.id,
      fingerprint,
      nodeId: sourceNodeId,
      severity: offline ? 'high' : 'medium',
      message: sibling
        ? `${offline ? 'Lien coupé' : 'Lien dégradé'} : ${a.name} ↔ ${b.name}${loss}${duration}. Même incident que le lien ${sibling}, déjà signalé par e-mail ; tests et rapport pour l’hébergeur disponibles dans Réseau privé.`
        : `${offline ? 'Lien coupé' : 'Lien dégradé'} : ${a.name} ↔ ${b.name}${loss}${duration}. Tests top, ping, traceroute et MTR capturés depuis les deux serveurs ; rapport pour l’hébergeur envoyé par e-mail et disponible dans Réseau privé.`,
    });
    if (!created) return;
    this.logger.warn(`Link incident reported: ${a.name} <-> ${b.name} (${event.status})${sibling ? `, grouped with ${sibling}` : ''}`);

    const alert = await this.prisma.alert.findFirst({
      where: { fingerprint, status: { not: 'resolved' } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    const markNotified = () =>
      alert ? this.prisma.alert.update({ where: { id: alert.id }, data: { emailNotifiedAt: new Date() } }) : Promise.resolve();
    // Already in the email of the link it shares a server with.
    if (sibling) {
      await markNotified();
      return;
    }

    // Without a relay the alert digest marks it as handled.
    if (!this.mailService.isConfigured) return;
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
        degradedForMs: unhealthyMs,
        observedForMs: INCIDENT_OBSERVE_MS,
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

  /**
   * Another link of one of these servers whose incident is open and was
   * already emailed, named "A ↔ B" - null when there is none.
   */
  private async emailedSiblingIncident(vlanId: string, nodeA: string, nodeB: string): Promise<string | null> {
    const open = await this.prisma.alert.findMany({
      where: {
        fingerprint: { startsWith: `link-degraded:${vlanId}:` },
        status: { not: 'resolved' },
        emailNotifiedAt: { not: null },
      },
      select: { fingerprint: true },
      orderBy: { createdAt: 'asc' },
    });
    const own = alertKey.linkDegraded(vlanId, nodeA, nodeB);
    for (const { fingerprint } of open) {
      const nodes = fingerprint && fingerprint !== own ? linkDegradedNodes(fingerprint) : null;
      if (!nodes || !(nodes.includes(nodeA) || nodes.includes(nodeB))) continue;
      const named = await this.prisma.node.findMany({ where: { id: { in: nodes } }, select: { id: true, name: true } });
      const name = (id: string) => named.find((node) => node.id === id)?.name ?? 'serveur supprimé';
      return `${name(nodes[0])} ↔ ${name(nodes[1])}`;
    }
    return null;
  }

  @Cron('25 3 * * *')
  async pruneOldCaptures() {
    const cutoff = new Date(Date.now() - CAPTURE_RETENTION_DAYS * 24 * 3_600_000);
    const { count } = await this.prisma.linkCapture.deleteMany({ where: { createdAt: { lt: cutoff } } });
    if (count > 0) this.logger.log(`Pruned ${count} link capture(s)`);
  }
}
