import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { VlanService } from '../vlan/vlan.service';
import { alertKey, parseAlertKey } from './alert-keys';
import { autoResolveAlerts, nodesWithOutageAlert, raiseAlert } from './alert-lifecycle';
import {
  isNodeFresh,
  NODE_SUPERVISION_WINDOW_MS,
  NodeSignal,
  planNodeOutageReports,
  RecoveryGate,
  STARTUP_GRACE_MS,
} from './node-availability';

// How long a condition has to stay clear before its alert is closed, for
// the ones that tend to flap. Everything else closes on the first check
// that sees it fixed (a sync run that succeeded will not un-succeed).
const CONFIRM_MS: Record<string, number> = {
  'node-offline': 2 * 60_000,
  'nodes-offline': 2 * 60_000,
  // Links flap more than agents do (a WireGuard handshake that comes and
  // goes): a link has to hold for a while before it is called fixed.
  'vlan-link': 5 * 60_000,
};

// Verdict on an alert's condition: still a problem, gone, or nothing this
// service can tell (left to whoever raised it, or to a person).
type Condition = 'active' | 'cleared' | 'unknown';

/**
 * Keeps the Alertes page in step with reality:
 *  - reports nodes whose agent went silent (one alert per outage, grouped
 *    when several nodes of a workspace drop together);
 *  - closes, as "résolue automatiquement", every alert whose condition has
 *    cleared - a node back online, a VLAN link up again, a sync job that
 *    ran fine... - so an outage does not leave a page of stale red behind.
 */
@Injectable()
export class AlertSupervisorService {
  private readonly logger = new Logger(AlertSupervisorService.name);
  private readonly bootedAt = Date.now();
  private readonly gate = new RecoveryGate();
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly vlanService: VlanService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      // Right after a restart every node reads offline until its agent
      // reconnects, and in-memory state (failovers) starts empty: neither
      // reporting nor closing is reliable yet.
      if (Date.now() - this.bootedAt < STARTUP_GRACE_MS) return;
      await this.reportSilentNodes();
      await this.closeClearedAlerts();
    } catch (error) {
      this.logger.warn(`Alert supervision failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  private async reportSilentNodes() {
    const now = Date.now();
    const nodes: NodeSignal[] = await this.prisma.node.findMany({
      where: {
        lastSeenAt: { gte: new Date(now - NODE_SUPERVISION_WINDOW_MS) },
        // An uninstalled agent leaves its node behind, out of every VLAN:
        // it is gone on purpose, not down.
        vlanMemberships: { some: {} },
      },
      select: { id: true, name: true, workspaceId: true, status: true, lastSeenAt: true, mutedUntil: true },
    });
    if (nodes.every((node) => isNodeFresh(node, now))) return;

    const covered = await nodesWithOutageAlert(this.prisma);
    for (const report of planNodeOutageReports(nodes, covered, now)) {
      const [first] = report.nodes;
      const created =
        report.nodes.length === 1
          ? await raiseAlert(this.prisma, {
              workspaceId: report.workspaceId,
              fingerprint: alertKey.nodeOffline(first.id),
              nodeId: first.id,
              severity: 'high',
              message: `Nœud ${first.name} injoignable : son agent ne répond plus (serveur arrêté, réseau coupé ou agent stoppé).`,
            })
          : await raiseAlert(this.prisma, {
              workspaceId: report.workspaceId,
              fingerprint: alertKey.nodesOffline(report.workspaceId, report.nodes.map((node) => node.id)),
              severity: 'high',
              message: `${report.nodes.length} nœuds injoignables en même temps : ${report.nodes.map((node) => node.name).join(', ')}. Une cause commune est probable (panne chez l'hébergeur, coupure réseau, ou connexion du serveur Tarmac).`,
            });
      if (created) this.logger.warn(`Outage reported: ${report.nodes.map((node) => node.name).join(', ')}`);
    }
  }

  private async closeClearedAlerts() {
    const open = await this.prisma.alert.findMany({
      where: { status: { not: 'resolved' }, fingerprint: { not: null } },
      select: { fingerprint: true },
      distinct: ['fingerprint'],
    });
    const keys = open.map((alert) => alert.fingerprint!);
    this.gate.retain(new Set(keys));

    const now = Date.now();
    const toClose: string[] = [];
    for (const key of keys) {
      const condition = await this.evaluate(key, now);
      if (condition === 'unknown') continue;
      const kind = parseAlertKey(key).kind;
      if (this.gate.observe(key, condition === 'cleared', CONFIRM_MS[kind] ?? 0, now)) toClose.push(key);
    }

    if (toClose.length === 0) return;
    const count = await autoResolveAlerts(this.prisma, toClose);
    this.logger.log(`Auto-resolved ${count} alert(s): ${toClose.join(', ')}`);
  }

  private async evaluate(key: string, now: number): Promise<Condition> {
    const { kind, parts } = parseAlertKey(key);
    const verdict = (active: boolean): Condition => (active ? 'active' : 'cleared');

    switch (kind) {
      case 'node-offline': {
        const node = await this.prisma.node.findUnique({ where: { id: parts[0] }, select: { status: true, lastSeenAt: true } });
        return verdict(!!node && !isNodeFresh(node, now));
      }
      case 'nodes-offline': {
        // Open until every node of the group is back (or was removed).
        const ids = (parts[1] ?? '').split(',').filter(Boolean);
        const nodes = await this.prisma.node.findMany({ where: { id: { in: ids } }, select: { status: true, lastSeenAt: true } });
        return verdict(nodes.some((node) => !isNodeFresh(node, now)));
      }
      case 'vlan-link': {
        const [vlanId, nodeA, nodeB] = parts;
        const links = await this.prisma.vlanConnection.findMany({
          where: {
            vlanId,
            OR: [
              { sourceNodeId: nodeA, targetNodeId: nodeB },
              { sourceNodeId: nodeB, targetNodeId: nodeA },
            ],
          },
          select: { status: true },
        });
        // No row left: the link was removed with a node or a VLAN.
        return verdict(links.some((link) => link.status === 'offline'));
      }
      case 'gateway-failover': {
        const [vlanId, region] = parts;
        return verdict(this.vlanService.isFailedOver(vlanId, region as Parameters<VlanService['isFailedOver']>[1]));
      }
      case 'mount-stuck': {
        const mount = await this.prisma.mount.findUnique({
          where: { id: parts[0] },
          select: { status: true, node: { select: { status: true, lastSeenAt: true } } },
        });
        // Once the agent is back, reconciliation applies the mount; a
        // failure from there gets its own alert.
        return verdict(!!mount && mount.status === 'pending' && !(mount.node && isNodeFresh(mount.node, now)));
      }
      case 'mount-error': {
        const mount = await this.prisma.mount.findUnique({ where: { id: parts[0] }, select: { status: true } });
        if (!mount || mount.status === 'active') return 'cleared';
        return mount.status === 'error' ? 'active' : 'unknown';
      }
      case 'sync-job': {
        const job = await this.prisma.syncJob.findUnique({ where: { id: parts[0] }, select: { status: true } });
        if (!job || job.status === 'success') return 'cleared';
        return job.status === 'failed' ? 'active' : 'unknown';
      }
      case 'smart': {
        const [nodeId, level, ...rest] = parts;
        const diskName = rest.join(':');
        const node = await this.prisma.node.findUnique({ where: { id: nodeId }, select: { smartMonitoringEnabled: true } });
        if (!node || !node.smartMonitoringEnabled) return 'cleared';
        const latest = await this.prisma.smartReport.findFirst({
          where: { nodeId, diskName },
          orderBy: { collectedAt: 'desc' },
          select: { overall: true },
        });
        if (!latest || latest.overall === 'unknown') return 'unknown';
        return verdict(latest.overall === level);
      }
      case 'dns-port-group': {
        const members = await this.prisma.dnsServerGroupMember.findMany({ where: { nodeId: parts[0] }, select: { conflictDetail: true } });
        return verdict(members.some((member) => member.conflictDetail !== null));
      }
      case 'dns-port-forwarder': {
        const node = await this.prisma.node.findUnique({ where: { id: parts[0] }, select: { internalDnsForwarderStatus: true } });
        return verdict(node?.internalDnsForwarderStatus === 'conflict');
      }
      case 'dns-sync': {
        const [zoneId, nodeId] = parts;
        const zone = await this.prisma.dnsZone.findUnique({ where: { id: zoneId }, select: { syncDetail: true } });
        const detail = Array.isArray(zone?.syncDetail) ? (zone!.syncDetail as Array<{ nodeId?: string; behindSince?: string | null }>) : [];
        const entry = detail.find((member) => member.nodeId === nodeId);
        return verdict(!!entry?.behindSince);
      }
      case 'dns-maintenance': {
        const [nodeId, task] = parts;
        const node = await this.prisma.node.findUnique({ where: { id: nodeId }, select: { dnsServerState: true } });
        if (!node) return 'cleared';
        const state = node.dnsServerState as { maxAttempts?: number; tasks?: Record<string, { status?: string; attempts?: number }> } | null;
        // No state while the agent is offline or between restarts.
        if (!state?.tasks) return 'unknown';
        const entry = state.tasks[task];
        return verdict(!!entry && entry.status === 'failed' && (entry.attempts ?? 0) >= (state.maxAttempts ?? Infinity));
      }
      default:
        // rule:* is closed by the rule evaluator, system:* by the loop
        // that raised it.
        return 'unknown';
    }
  }
}
