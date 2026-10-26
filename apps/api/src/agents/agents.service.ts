import { forwardRef, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DnsDelegationCheckService } from '../dns/dns-delegation-check.service';
import { DnsGroupsService } from '../dns/dns-groups.service';
import { InternalDnsService } from '../dns/internal-dns.service';
import { DnsZonesService } from '../dns/dns-zones.service';
import { MigrationsService } from '../migrations/migrations.service';
import { MountsService } from '../mounts/mounts.service';
import { PoolsService } from '../pools/pools.service';
import { SharesService } from '../shares/shares.service';
import { VlanService } from '../vlan/vlan.service';
import { VpnService } from '../vpn/vpn.service';
import { Region, resolveRegion } from '../vlan/region';
import { AgentLogsService } from '../agent-logs/agent-logs.service';
import { LiveWsServer } from '../live/live.ws';
import { DEFAULT_WORKSPACE_ID } from '../workspaces/default-workspace';
import {
  AgentLogPayload,
  CommandPayload,
  CommandProgressPayload,
  CommandResultPayload,
  HeartbeatPayload,
  StateReportPayload,
} from './agents.types';

type SendFn = (event: string, payload: unknown) => void;
type PendingDirectoryRequest = {
  nodeId: string;
  resolve: (value: { basePath: string; directories: string[] }) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
};
type PendingDirectoryScanRequest = {
  nodeId: string;
  resolve: (value: {
    basePath: string;
    entries: Array<{ path: string; sizeBytes: number }>;
    truncated: boolean;
  }) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
};
type PendingTracerouteRequest = {
  nodeId: string;
  resolve: (value: { targetIp: string; hops: Array<{ hop: number; ip: string | null; latencyMs: number | null }> }) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
};
export type PingResult = {
  targetIp: string;
  sent: number;
  packetLoss: number;
  minMs: number | null;
  avgMs: number | null;
  maxMs: number | null;
};
type PendingPingRequest = {
  nodeId: string;
  resolve: (value: PingResult) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
};
type PendingDnsZoneKeysRequest = {
  nodeId: string;
  resolve: (value: { dsRecords: string[]; dnskeyRecords: string[] }) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
};

// Node is considered offline if no heartbeat received within this time
const NODE_HEARTBEAT_TIMEOUT_MS = 60 * 1000; // 60 seconds
const LINK_OFFLINE_HANDSHAKE_SEC = 600;
const LINK_DEGRADED_HANDSHAKE_SEC = 240;
// A link between two nodes in the same region is expected to stay well under
// this; a link crossing regions (e.g. an intercontinental gateway backbone)
// has a much higher physical floor (~80-120ms for a transatlantic hop) that
// isn't itself a sign of trouble, so it gets a separate, higher bar.
const LINK_DEGRADED_LATENCY_MS = 180;
const LINK_DEGRADED_LATENCY_CROSS_REGION_MS = 300;

// Retry config for deadlock handling
const MAX_DEADLOCK_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 100;
const MAX_RETRY_JITTER_MS = 50;

// SMART attributes only refresh every few minutes on the agent side, so
// re-alerting on every 20s state report while a disk stays degraded would
// just be noise for the same underlying condition.
const SMART_ALERT_COOLDOWN_MS = 60 * 60 * 1000;

// Heartbeat-triggered overlay reconcile is only a drift-correction safety net
// (real changes trigger reconcileOverlayForNode directly), so it doesn't need
// to run often — gated per VLAN to avoid one broadcast per node heartbeat.
const OVERLAY_RECONCILE_INTERVAL_MS = 3 * 60 * 1000;

// Commands whose failure leaves the agent itself unmanageable (can't update,
// can't uninstall cleanly, can't rotate its auth token) are more severe than
// a single resource command failing, so they're logged as critical rather
// than a routine error.
const AGENT_CRITICAL_COMMANDS = new Set(['update_agent', 'uninstall_agent', 'rotate_token']);

@Injectable()
export class AgentsService implements OnModuleInit {
  // Longest gap tolerated between two stored SMART reports for the same
  // disk when nothing changed, so smartHistory still has a point every so
  // often instead of a flat line with one sample. 15min x 200 points
  // (smartHistory's take) is ~2 days of history per disk.
  private static readonly SMART_REPORT_HEARTBEAT_MS = 15 * 60 * 1000;
  private readonly logger = new Logger(AgentsService.name);
  private readonly senders = new Map<string, SendFn>();
  private readonly overlaySyncAt = new Map<string, number>();
  private readonly pendingDirectoryRequests = new Map<string, PendingDirectoryRequest>();
  private readonly pendingDirectoryScanRequests = new Map<string, PendingDirectoryScanRequest>();
  private readonly pendingTracerouteRequests = new Map<string, PendingTracerouteRequest>();
  private readonly pendingPingRequests = new Map<string, PendingPingRequest>();
  private readonly pendingDnsZoneKeysRequests = new Map<string, PendingDnsZoneKeysRequest>();
  private readonly smartAlertAt = new Map<string, number>();

  private normalizeFailureMessage(message?: string | null) {
    if (!message) return 'unknown error';
    const compact = message.replace(/\s+/g, ' ').trim();
    return compact.length > 700 ? `${compact.slice(0, 697)}...` : compact;
  }

  private async retryWithExponentialBackoff<T>(
    fn: () => Promise<T>,
    operation: string,
  ): Promise<T> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < MAX_DEADLOCK_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        const isDeadlock = this.isDeadlockError(error);
        if (!isDeadlock || attempt === MAX_DEADLOCK_RETRIES - 1) throw error;
        const delayMs =
          INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt) +
          Math.floor(Math.random() * MAX_RETRY_JITTER_MS);
        this.logger.warn(
          `${operation} deadlock (attempt ${attempt + 1}/${MAX_DEADLOCK_RETRIES}), retrying in ${delayMs}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    throw lastError;
  }

  private isDeadlockError(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return true;
    }

    const message = error instanceof Error ? error.message : String(error);
    return /deadlock detected/i.test(message) || /\b40P01\b/i.test(message);
  }

  private async createSystemAlert(message: string, severity: 'medium' | 'high' | 'critical' = 'high') {
    await this.prisma.alert.create({
      data: {
        workspaceId: DEFAULT_WORKSPACE_ID,
        severity,
        message: this.normalizeFailureMessage(message),
      },
    });
  }

  private async createMigrationFailureAlert(params: {
    migrationId: string;
    migrationName: string;
    nodeId?: string | null;
    sourceName?: string | null;
    targetName?: string | null;
    progress: number;
    errorMessage: string;
  }) {
    const source = params.sourceName?.trim() || 'unknown-source';
    const target = params.targetName?.trim() || 'unknown-target';
    const message = `Migration "${params.migrationName}" failed at ${params.progress}% (${source} -> ${target}): ${params.errorMessage}`;

    await this.prisma.alert.create({
      data: {
        workspaceId: DEFAULT_WORKSPACE_ID,
        nodeId: params.nodeId ?? null,
        severity: 'high',
        message,
      },
    });
  }

  private async createSyncJobFailureAlert(params: {
    syncJobId: string;
    syncJobName: string;
    nodeId?: string | null;
    errorMessage: string;
  }) {
    const message = `Réplication "${params.syncJobName}" en échec : ${params.errorMessage}`;

    await this.prisma.alert.create({
      data: {
        workspaceId: DEFAULT_WORKSPACE_ID,
        nodeId: params.nodeId ?? null,
        severity: 'high',
        message,
      },
    });
  }

  private async createMountFailureAlert(params: {
    mountId: string;
    mountName: string;
    nodeId?: string | null;
    nodeName?: string | null;
    sourcePath: string;
    targetPath: string;
    errorMessage: string;
  }) {
    const node = params.nodeName?.trim() || 'unknown-node';
    const message = `Montage "${params.mountName}" en erreur sur ${node} (${params.sourcePath} -> ${params.targetPath}): ${params.errorMessage}`;

    await this.prisma.alert.create({
      data: {
        workspaceId: DEFAULT_WORKSPACE_ID,
        nodeId: params.nodeId ?? null,
        severity: 'high',
        message,
      },
    });
  }

  private async createDnsPortConflictAlert(params: {
    nodeId: string;
    nodeName?: string | null;
    port: number;
    protocol: string;
    processName?: string | null;
    pid?: number | null;
  }) {
    const node = params.nodeName?.trim() || params.nodeId;
    const process = params.processName ? `${params.processName}${params.pid ? ` (pid ${params.pid})` : ''}` : 'un autre process';
    const message = `DNS : le port ${params.port}/${params.protocol} est déjà utilisé sur ${node} par ${process} - PowerDNS n'a pas pu démarrer.`;

    await this.prisma.alert.create({
      data: {
        workspaceId: DEFAULT_WORKSPACE_ID,
        nodeId: params.nodeId,
        severity: 'high',
        message,
      },
    });
  }

  private async createSmartHealthAlert(params: {
    nodeId: string;
    diskName: string;
    overall: 'warning' | 'critical';
    temperatureC: number;
    reallocatedSectors: number;
    pendingSectors: number;
  }) {
    const cooldownKey = `${params.nodeId}:${params.diskName}:${params.overall}`;
    const lastAlertAt = this.smartAlertAt.get(cooldownKey) ?? 0;
    if (Date.now() - lastAlertAt < SMART_ALERT_COOLDOWN_MS) return;
    this.smartAlertAt.set(cooldownKey, Date.now());

    const node = await this.prisma.node.findUnique({
      where: { id: params.nodeId },
      select: { name: true, mutedUntil: true, smartMonitoringEnabled: true },
    });
    // A node whose storage is virtualised reports SMART attributes that
    // belong to the hypervisor, or none at all; its operator can opt out
    // (see Node.smartMonitoringEnabled) rather than live with a disk alert
    // that will never be actionable.
    if (node && !node.smartMonitoringEnabled) return;
    if (node?.mutedUntil && node.mutedUntil.getTime() > Date.now()) return;
    const nodeName = node?.name ?? params.nodeId;
    const severity = params.overall === 'critical' ? 'critical' : 'medium';
    const label = params.overall === 'critical' ? 'en échec' : 'dégradé';
    const message = `SMART : disque "${params.diskName}" sur ${nodeName} ${label} (secteurs réalloués: ${params.reallocatedSectors}, en attente: ${params.pendingSectors}, température: ${params.temperatureC}°C)`;

    await this.prisma.alert.create({
      data: {
        workspaceId: DEFAULT_WORKSPACE_ID,
        nodeId: params.nodeId,
        severity,
        message,
      },
    });

    if (params.overall === 'critical') {
      const disk = await this.prisma.disk.findFirst({
        where: { nodeId: params.nodeId, physicalDisks: { has: params.diskName } },
      });
      if (disk) {
        try {
          await this.migrationsService.suggestMigrationForCriticalDisk({
            nodeId: params.nodeId,
            diskName: params.diskName,
            mountPath: disk.mountPath,
          });
        } catch (error) {
          this.logger.warn(
            `Failed to suggest remediation migration for disk ${params.diskName} on node ${params.nodeId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }
  }

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => MigrationsService))
    private readonly migrationsService: MigrationsService,
    private readonly sharesService: SharesService,
    @Inject(forwardRef(() => MountsService))
    private readonly mountsService: MountsService,
    private readonly poolsService: PoolsService,
    @Inject(forwardRef(() => DnsGroupsService))
    private readonly dnsGroupsService: DnsGroupsService,
    @Inject(forwardRef(() => DnsZonesService))
    private readonly dnsZonesService: DnsZonesService,
    @Inject(forwardRef(() => DnsDelegationCheckService))
    private readonly dnsDelegationCheckService: DnsDelegationCheckService,
    @Inject(forwardRef(() => InternalDnsService))
    private readonly internalDnsService: InternalDnsService,
    private readonly vlanService: VlanService,
    private readonly agentLogsService: AgentLogsService,
    private readonly live: LiveWsServer,
    @Inject(forwardRef(() => VpnService))
    private readonly vpnService: VpnService,
  ) {}

  onModuleInit() {
    // Initialize: mark all nodes as offline on startup, they'll come back online as they heartbeat
    this.markAllNodesOffline();
  }

  register(nodeId: string, send: SendFn) {
    this.senders.set(nodeId, send);
    void this.vpnService.onAgentConnected(nodeId);
  }

  unregister(nodeId: string) {
    this.senders.delete(nodeId);
    for (const [requestId, request] of this.pendingDirectoryRequests.entries()) {
      if (request.nodeId !== nodeId) continue;
      clearTimeout(request.timeout);
      request.reject(new Error(`node ${nodeId} disconnected`));
      this.pendingDirectoryRequests.delete(requestId);
    }
    for (const [requestId, request] of this.pendingDirectoryScanRequests.entries()) {
      if (request.nodeId !== nodeId) continue;
      clearTimeout(request.timeout);
      request.reject(new Error(`node ${nodeId} disconnected`));
      this.pendingDirectoryScanRequests.delete(requestId);
    }
    for (const [requestId, request] of this.pendingTracerouteRequests.entries()) {
      if (request.nodeId !== nodeId) continue;
      clearTimeout(request.timeout);
      request.reject(new Error(`node ${nodeId} disconnected`));
      this.pendingTracerouteRequests.delete(requestId);
    }
    for (const [requestId, request] of this.pendingPingRequests.entries()) {
      if (request.nodeId !== nodeId) continue;
      clearTimeout(request.timeout);
      request.reject(new Error(`node ${nodeId} disconnected`));
      this.pendingPingRequests.delete(requestId);
    }
    for (const [requestId, request] of this.pendingDnsZoneKeysRequests.entries()) {
      if (request.nodeId !== nodeId) continue;
      clearTimeout(request.timeout);
      request.reject(new Error(`node ${nodeId} disconnected`));
      this.pendingDnsZoneKeysRequests.delete(requestId);
    }
  }

  isConnected(nodeId?: string | null) {
    if (!nodeId) return false;
    return this.senders.has(nodeId);
  }

  private async markAllNodesOffline() {
    try {
      await this.prisma.node.updateMany({
        where: { status: 'online' },
        data: { status: 'offline' },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('Failed to mark nodes offline on startup:', error);
      await this.createSystemAlert(`Agents bootstrap warning: failed to mark nodes offline (${message})`, 'medium');
    }
  }

  /**
   * Runs every 30 seconds to check for nodes without recent heartbeats
   * Marks nodes as offline if no heartbeat received within NODE_HEARTBEAT_TIMEOUT_MS
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async checkNodeHeartbeats() {
    try {
      const cutoffTime = new Date(Date.now() - NODE_HEARTBEAT_TIMEOUT_MS);
      
      // Find nodes that are marked online but haven't sent heartbeat recently
      const timedOutNodes = await this.prisma.node.findMany({
        where: {
          status: 'online',
          OR: [
            { lastSeenAt: { lt: cutoffTime } },
            { lastSeenAt: null },
          ],
        },
      });

      if (timedOutNodes.length > 0) {
        for (const node of timedOutNodes) {
          this.logger.warn(`Node ${node.name} (${node.id}) marked offline - no heartbeat since ${node.lastSeenAt || 'startup'}`);
        }
        await this.prisma.node.updateMany({
          where: { id: { in: timedOutNodes.map((node) => node.id) } },
          data: { status: 'offline' },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Error checking node heartbeats:', error);
      await this.createSystemAlert(`Heartbeat monitor failed: ${message}`, 'high');
    }
  }

  // `nodeId` is the identity the WebSocket connection authenticated as
  // (verified against that node's own token at handshake time - see
  // AgentsWsServer.attachClient) - NOT payload.nodeId, which is attacker-
  // controlled: a compromised agent could otherwise claim to be any other
  // node (in any workspace) simply by putting a different nodeId in the
  // message body. Any `nodeId` field still present in the payload itself is
  // ignored on purpose.
  async onAgentLog(nodeId: string, payload: AgentLogPayload) {
    if (!payload.message) return;
    const workspaceId = await this.resolveCallingNodeWorkspace(nodeId);
    if (!workspaceId) return;
    return this.agentLogsService.create({
      nodeId,
      level: payload.level || 'info',
      message: payload.message,
      workspaceId,
    });
  }

  async onHeartbeat(nodeId: string, payload: HeartbeatPayload) {
    const { metrics, overlay, linkMetrics, vpnPeers, version } = payload;
    const now = new Date();
    const versionFields = version ? { agentVersion: version, agentVersionAt: now } : {};

    const node = await this.prisma.node
      .update({
        where: { id: nodeId },
        data: {
          status: 'online',
          lastSeenAt: now,
          overlayPublicKey: overlay?.publicKey,
          overlayEndpoint: overlay?.endpoint,
          overlayListenPort: overlay?.listenPort,
          overlaySshPublicKey: overlay?.sshPublicKey,
          overlaySshUser: overlay?.sshUser,
          ...versionFields,
        },
      })
      .catch(async () => {
        // Node doesn't exist, create it and join VLAN
        const created = await this.prisma.node.create({
          data: {
            id: nodeId,
            workspaceId: DEFAULT_WORKSPACE_ID,
            name: `node-${nodeId.slice(0, 6)}`,
            role: 'worker',
            status: 'online',
            lastSeenAt: now,
            overlayPublicKey: overlay?.publicKey,
            overlayEndpoint: overlay?.endpoint,
            overlayListenPort: overlay?.listenPort,
            overlaySshPublicKey: overlay?.sshPublicKey,
            overlaySshUser: overlay?.sshUser,
            ...versionFields,
          },
        });
        
    // Auto-join VLAN when agent starts (with guaranteed VLAN creation)
    try {
      // Ensure the workspace's VLAN exists first, then join the agent to it
      await this.vlanService.getOrCreateVlan(created.workspaceId);
      await this.vlanService.joinVlan(nodeId, created.workspaceId);
      this.logger.log(`✅ Node ${nodeId} created and joined VLAN`);
    } catch (error) {
      this.logger.warn(`⚠️  Failed to create VLAN or join node ${nodeId}:`, error);
    }

        return created;
      });

    // Ensure VLAN membership on every heartbeat (idempotent). Single lookup reused below
    // for the reconcile gate too, instead of two overlapping vlanMember queries per heartbeat.
    let membership = await this.prisma.vlanMember.findFirst({ where: { nodeId } });
    try {
      if (!membership) {
        // Ensure the node's own workspace VLAN exists, then join if not already joined
        await this.vlanService.getOrCreateVlan(node.workspaceId);
        await this.vlanService.joinVlan(nodeId, node.workspaceId);
        this.logger.log(`✅ Node ${nodeId} joined VLAN on heartbeat`);
        membership = await this.prisma.vlanMember.findFirst({ where: { nodeId } });
      }
    } catch (error) {
      this.logger.warn(`⚠️  Failed to ensure VLAN membership for node ${nodeId}:`, error);
    }

    await this.prisma.metricSample.create({
      data: {
        nodeId,
        cpu: metrics.cpu,
        ram: metrics.ram,
        disk: metrics.disk,
        networkRx: metrics.networkRx ?? 0,
        networkTx: metrics.networkTx ?? 0,
        ioRead: metrics.ioRead ?? 0,
        ioWrite: metrics.ioWrite ?? 0,
      },
    });

    // Lets the dashboard patch this node's status/metrics/version into its
    // local cache the instant a heartbeat lands, instead of waiting for its
    // next poll tick (up to 5s away) - see useLiveSocket usage in
    // app/[workspace]/dashboard/page.tsx and infrastructure/page.tsx. Poll-
    // ing keeps running underneath as the fallback/reconciliation path, this
    // is purely additive. Deliberately a lean payload (not the full
    // NodeActivityItem shape) - just enough to patch the fields that change
    // every heartbeat. agentVersion/agentVersionAt come from `node` (the
    // just-updated row), not from `version`/`versionFields` above, so they're
    // always the current DB value whether or not the agent reported a new
    // version on this specific heartbeat - e.g. after "update agent" the
    // agent restarts and only reports its new version on the first heartbeat
    // after reconnecting, but every heartbeat's row already reflects
    // whatever the last-known value was.
    this.live.broadcast(
      'node.heartbeat',
      {
        nodeId,
        status: node.status,
        lastSeenAt: now.toISOString(),
        agentVersion: node.agentVersion,
        agentVersionAt: node.agentVersionAt ? node.agentVersionAt.toISOString() : null,
        metrics: {
          cpu: metrics.cpu,
          ram: metrics.ram,
          disk: metrics.disk,
          networkRx: metrics.networkRx ?? 0,
          networkTx: metrics.networkTx ?? 0,
          ioRead: metrics.ioRead ?? 0,
          ioWrite: metrics.ioWrite ?? 0,
        },
      },
      node.workspaceId,
    );

    if (linkMetrics && linkMetrics.length > 0) {
      try {
        await this.ingestOverlayLinkMetrics(nodeId, linkMetrics);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to ingest link metrics for node ${nodeId}: ${message}`, error);
      }
    }

    if (vpnPeers && vpnPeers.length > 0) {
      try {
        await this.vpnService.ingestPeerStats(nodeId, node.workspaceId, vpnPeers);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to ingest VPN peer stats for node ${nodeId}: ${message}`);
      }
    }

    // Heartbeat-triggered reconcile is a drift-correction safety net, not the primary
    // trigger (membership/key changes already call reconcileOverlayForNode directly).
    // Gate on the VLAN, not the node: reconcileOverlayForNode broadcasts to every member,
    // so gating per-node still let each node's heartbeat re-trigger a full VLAN broadcast.
    if (membership) {
      const lastSync = this.overlaySyncAt.get(membership.vlanId) ?? 0;
      if (Date.now() - lastSync >= OVERLAY_RECONCILE_INTERVAL_MS) {
        await this.reconcileOverlayForNode(nodeId);
        this.overlaySyncAt.set(membership.vlanId, Date.now());
      }
    }
  }

  async onStateReport(nodeId: string, payload: StateReportPayload) {
    // Go marshals an empty slice it never allocated as `null`: a freshly
    // restarted agent (every deploy pushes an update, so all of them at once)
    // sends `smartReports: null` until its first background smartctl pass
    // lands, and a host with no disk to report sends `disks: null`.
    const disks = payload.disks ?? [];
    const smartReports = payload.smartReports ?? [];

    for (const disk of disks) {
      await this.prisma.disk.upsert({
        where: { nodeId_name: { nodeId, name: disk.name } },
        update: {
          mountPath: disk.mountPath,
          type: disk.type,
          health: disk.health,
          capacityGb: disk.capacityGb,
          usedGb: disk.usedGb,
          physicalDisks: disk.physicalDisks ?? [],
        },
        create: {
          nodeId,
          name: disk.name,
          mountPath: disk.mountPath,
          type: disk.type,
          health: disk.health,
          capacityGb: disk.capacityGb,
          usedGb: disk.usedGb,
          physicalDisks: disk.physicalDisks ?? [],
        },
      });
    }

    // Remove disks no longer reported by the agent (e.g. unmounted or
    // no-longer-tracked NFS shares) so stale entries don't inflate storage totals.
    if (disks.length > 0) {
      await this.prisma.disk.deleteMany({
        where: {
          nodeId,
          name: { notIn: disks.map((disk) => disk.name) },
        },
      });
    }

    if (smartReports.length > 0) {
      // Agents send a full state report every 20s, but SMART attributes
      // (temperature aside) move on the scale of hours - appending every
      // one of those meant ~4,300 rows/disk/day of near-duplicates. Keep a
      // new row only when something actually changed, or when the last one
      // is old enough to still give smartHistory a usable time series.
      // Scoped to the heartbeat window on purpose: a disk with no row in it
      // needs a new one regardless (either it's brand new, or its last
      // report is stale enough that we want a fresh time-series point), and
      // the bound is what keeps this lookup off the full history. Prisma's
      // `distinct` is applied in memory, so without it this would read every
      // SMART row this node ever produced on every state report.
      const heartbeatCutoff = new Date(Date.now() - AgentsService.SMART_REPORT_HEARTBEAT_MS);
      const recentPerDisk = await this.prisma.smartReport.findMany({
        where: {
          nodeId,
          diskName: { in: smartReports.map((report) => report.diskName) },
          collectedAt: { gte: heartbeatCutoff },
        },
        orderBy: [{ diskName: 'asc' }, { collectedAt: 'desc' }],
        distinct: ['diskName'],
      });
      const latestByDiskName = new Map(recentPerDisk.map((report) => [report.diskName, report]));

      const changed = smartReports.filter((report) => {
        const previous = latestByDiskName.get(report.diskName);
        if (!previous) return true;
        return (
          previous.temperatureC !== report.temperatureC ||
          previous.reallocatedSectors !== report.reallocatedSectors ||
          previous.pendingSectors !== report.pendingSectors ||
          previous.powerOnHours !== report.powerOnHours ||
          previous.overall !== report.overall
        );
      });

      if (changed.length > 0) {
        await this.prisma.smartReport.createMany({
          data: changed.map((report) => ({
            nodeId,
            diskName: report.diskName,
            temperatureC: report.temperatureC,
            reallocatedSectors: report.reallocatedSectors,
            pendingSectors: report.pendingSectors,
            powerOnHours: report.powerOnHours,
            overall: report.overall,
          })),
        });
      }

      for (const report of smartReports) {
        if (report.overall !== 'warning' && report.overall !== 'critical') continue;
        await this.createSmartHealthAlert({
          nodeId,
          diskName: report.diskName,
          overall: report.overall,
          temperatureC: report.temperatureC,
          reallocatedSectors: report.reallocatedSectors,
          pendingSectors: report.pendingSectors,
        });
      }
    }
  }

  // `result.resourceId`/`progress.resourceId` are attacker-controlled (an
  // agent chooses what it reports finishing) - unlike heartbeat/state_report/
  // log above, `command_result`/`command_progress` DO already use the
  // handshake-verified `nodeId` for the calling node's own identity, but
  // several branches then blindly `update()` a share/mount/pool
  // member/sync job/migration purely by that attacker-supplied id, with no
  // check that the resource actually belongs to the calling node's
  // workspace. A compromised agent could otherwise flip the status of (or
  // attach a fabricated failure/log message to) any resource in any other
  // workspace just by guessing/knowing its id. This resolves the calling
  // node's own workspace once so each branch below can verify the target
  // resource is actually theirs before mutating it.
  private async resolveCallingNodeWorkspace(nodeId: string): Promise<string | null> {
    const node = await this.prisma.node.findUnique({ where: { id: nodeId }, select: { workspaceId: true } });
    return node?.workspaceId ?? null;
  }

  private logCrossWorkspaceAttempt(nodeId: string, resourceType: string, resourceId: string) {
    this.logger.warn(
      `Node ${nodeId} sent a command_result for ${resourceType}/${resourceId} outside its own workspace - ignored`,
    );
  }

  async onCommandResult(nodeId: string, result: CommandResultPayload) {
    this.logger.log(
      `Command result ${result.command} ${result.resourceId}: ${result.success}${
        result.success ? '' : ` (${result.message ?? 'no message'})`
      }`,
    );
    const callingWorkspaceId = await this.resolveCallingNodeWorkspace(nodeId);
    if (!callingWorkspaceId) {
      this.logger.warn(`Command result from unknown node ${nodeId} - ignored`);
      return;
    }

    const isAgentCritical =
      AGENT_CRITICAL_COMMANDS.has(result.command) ||
      result.resourceType === 'mount' ||
      result.resourceType === 'mount_cleanup';
    const level = result.success ? 'info' : isAgentCritical ? 'critical' : 'error';
    await this.agentLogsService.create({
      nodeId,
      level,
      message: `${result.command} (${result.resourceType}/${result.resourceId}): ${
        result.success ? 'succès' : 'échec'
      }${result.message ? ` — ${result.message}` : ''}`,
      workspaceId: callingWorkspaceId,
    });
    const status = result.success ? 'active' : 'error';

    if (result.resourceType === 'share') {
      const share = await this.prisma.share.findUnique({
        where: { id: result.resourceId },
        select: { workspaceId: true },
      });
      if (!share || share.workspaceId !== callingWorkspaceId) {
        this.logCrossWorkspaceAttempt(nodeId, result.resourceType, result.resourceId);
        return;
      }
      await this.sharesService.setStatus(result.resourceId, status);
      return;
    }

    if (result.resourceType === 'mount') {
      const mount = await this.prisma.mount.findUnique({
        where: { id: result.resourceId },
        select: { workspaceId: true },
      });
      if (!mount || mount.workspaceId !== callingWorkspaceId) {
        this.logCrossWorkspaceAttempt(nodeId, result.resourceType, result.resourceId);
        return;
      }
      const updatedMount = await this.mountsService.setStatus(result.resourceId, status, result.message);
      if (!result.success) {
        const errorMessage = this.normalizeFailureMessage(result.message);
        this.logger.error(`Mount ${updatedMount.id} (${updatedMount.name}) failed: ${errorMessage}`);
        await this.createMountFailureAlert({
          mountId: updatedMount.id,
          mountName: updatedMount.name,
          nodeId: updatedMount.nodeId,
          nodeName: updatedMount.node?.name,
          sourcePath: updatedMount.sourcePath,
          targetPath: updatedMount.targetPath,
          errorMessage,
        });
      }
      return;
    }

    if (result.resourceType === 'mount_cleanup') {
      if (!result.success) {
        const errorMessage = this.normalizeFailureMessage(result.message);
        this.logger.error(`Mount cleanup for ${result.resourceId} failed: ${errorMessage}`);
        await this.createSystemAlert(
          `Nettoyage du montage ${result.resourceId} incomplet sur le nœud : ${errorMessage}. Vérifie manuellement /etc/fstab et le point de montage (les données distantes n'ont pas été touchées).`,
        );
      } else {
        this.logger.log(`Mount cleanup for ${result.resourceId}: ${result.message ?? 'ok'}`);
      }
      return;
    }

    if (result.resourceType === 'pool_member') {
      // resourceId is "<poolId>:<nodeId>" - the node segment must be the
      // calling node itself, not just any node in the same workspace, since
      // a pool member's status can only legitimately be reported by that
      // exact member.
      const [poolId, memberNodeId] = result.resourceId.split(':');
      if (poolId && memberNodeId === nodeId) {
        await this.poolsService.setMemberStatus(poolId, memberNodeId, result.success ? 'active' : 'error');
      } else if (poolId && memberNodeId) {
        this.logCrossWorkspaceAttempt(nodeId, result.resourceType, result.resourceId);
      }
      return;
    }

    if (result.resourceType === 'dns_server_group_member') {
      // resourceId is "<groupId>:<nodeId>" - same ownership-check shape as
      // pool_member: this exact member is the only one allowed to report
      // its own status.
      const [groupId, memberNodeId] = result.resourceId.split(':');
      if (!groupId || memberNodeId !== nodeId) {
        if (groupId && memberNodeId) this.logCrossWorkspaceAttempt(nodeId, result.resourceType, result.resourceId);
        return;
      }

      const portConflict = result.data?.portConflict;
      const memberStatus = result.success ? 'active' : 'error';
      await this.dnsGroupsService.setGroupMemberStatus(
        groupId,
        memberNodeId,
        memberStatus,
        portConflict ? (portConflict as unknown as Prisma.InputJsonValue) : null,
      );
      // Lets the DNS page patch a member's status/conflict banner the
      // instant a command result lands, instead of waiting for its next
      // 15s poll tick - same "live.broadcast alongside the DB write"
      // pattern as node.heartbeat above.
      this.live.broadcast(
        'dns.group_member.status',
        { groupId, nodeId: memberNodeId, status: memberStatus, conflictDetail: portConflict ?? null },
        callingWorkspaceId,
      );

      if (result.success && result.data?.dnsTsigKeySecret) {
        await this.dnsGroupsService.setGroupTsigKeySecret(groupId, result.data.dnsTsigKeySecret);
      }

      if (!result.success && portConflict) {
        const node = await this.prisma.node.findUnique({ where: { id: nodeId }, select: { name: true } });
        await this.createDnsPortConflictAlert({
          nodeId,
          nodeName: node?.name,
          port: portConflict.port,
          protocol: portConflict.protocol,
          processName: portConflict.processName,
          pid: portConflict.pid,
        });
      } else if (!result.success) {
        this.logger.error(
          `DNS server group member ${result.resourceId} apply failed: ${this.normalizeFailureMessage(result.message)}`,
        );
      }
      return;
    }

    if (result.resourceType === 'internal_dns') {
      // resourceId is just the reporting node's own id (command.
      // setup_internal_dns/remove_internal_dns are single-node commands,
      // no groupId-style compound key needed). Guard against stale results
      // by only updating if this node is STILL the workspace's designated
      // one - this also naturally makes a command.remove_internal_dns
      // result a no-op once clearInternalDnsNode has already nulled the
      // field, without needing to branch on result.command.
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: callingWorkspaceId },
        select: { internalDnsNodeId: true },
      });
      if (workspace?.internalDnsNodeId !== nodeId) return;

      const internalDnsStatus = result.success ? 'active' : 'error';
      const internalDnsError = result.success ? null : this.normalizeFailureMessage(result.message);
      await this.internalDnsService.setStatus(callingWorkspaceId, internalDnsStatus, internalDnsError);
      this.live.broadcast('dns.internal.status', { status: internalDnsStatus, error: internalDnsError }, callingWorkspaceId);
      if (!result.success) {
        this.logger.error(`Internal DNS setup on node ${nodeId} failed: ${this.normalizeFailureMessage(result.message)}`);
      }
      return;
    }

    if (result.resourceType === 'internal_dns_route') {
      // resourceId is the reporting node's own id - same self-report-only
      // ownership check as pool_member above.
      if (result.resourceId !== nodeId) {
        this.logCrossWorkspaceAttempt(nodeId, result.resourceType, result.resourceId);
        return;
      }
      const data = result.data as { status?: string; conflict?: Record<string, unknown> } | undefined;
      const forwarderStatus = data?.status ?? (result.success ? 'active' : 'error');
      await this.prisma.node.update({
        where: { id: nodeId },
        data: {
          internalDnsForwarderStatus: forwarderStatus,
          internalDnsForwarderConflict: (data?.conflict as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        },
      });
      this.live.broadcast(
        'dns.internal.forwarder_status',
        { nodeId, status: forwarderStatus, conflict: data?.conflict ?? null },
        callingWorkspaceId,
      );
      if (forwarderStatus === 'conflict' && data?.conflict) {
        const node = await this.prisma.node.findUnique({ where: { id: nodeId }, select: { name: true } });
        const conflict = data.conflict as { port: number; protocol: string; processName?: string | null; pid?: number | null };
        await this.createDnsPortConflictAlert({
          nodeId,
          nodeName: node?.name,
          port: conflict.port,
          protocol: conflict.protocol,
          processName: conflict.processName,
          pid: conflict.pid,
        });
      } else if (!result.success) {
        this.logger.error(`Internal DNS forwarder on node ${nodeId} failed: ${this.normalizeFailureMessage(result.message)}`);
      }
      return;
    }

    if (result.resourceType === 'dns_zone') {
      const zone = await this.prisma.dnsZone.findUnique({
        where: { id: result.resourceId },
        select: { workspaceId: true },
      });
      if (!zone || zone.workspaceId !== callingWorkspaceId) {
        this.logCrossWorkspaceAttempt(nodeId, result.resourceType, result.resourceId);
        return;
      }
      const zoneStatus = result.success ? 'active' : 'error';
      await this.dnsZonesService.setZoneStatus(result.resourceId, zoneStatus);
      this.live.broadcast('dns.zone.status', { zoneId: result.resourceId, status: zoneStatus }, callingWorkspaceId);
      if (!result.success) {
        this.logger.error(`DNS zone ${result.resourceId} apply failed: ${this.normalizeFailureMessage(result.message)}`);
      } else {
        // The zone just went locally active - worth an immediate real-world
        // delegation check instead of waiting for the next 60s tick.
        // Fire-and-forget: a slow/failed check here must never block or
        // fail this command-result handler.
        void this.dnsDelegationCheckService.checkZoneUnscoped(result.resourceId);
      }
      return;
    }

    if (result.resourceType === 'dns_zone_keys') {
      const pending = this.pendingDnsZoneKeysRequests.get(result.resourceId);
      if (!pending || pending.nodeId !== nodeId) {
        if (pending) this.logCrossWorkspaceAttempt(nodeId, result.resourceType, result.resourceId);
        return;
      }

      clearTimeout(pending.timeout);
      this.pendingDnsZoneKeysRequests.delete(result.resourceId);

      if (!result.success) {
        pending.reject(new Error(result.message ?? 'failed to fetch dnssec keys'));
        return;
      }

      const dns = result.data?.dns;
      pending.resolve({
        dsRecords: Array.isArray(dns?.dsRecords) ? dns.dsRecords : [],
        dnskeyRecords: Array.isArray(dns?.dnskeyRecords) ? dns.dnskeyRecords : [],
      });
      return;
    }

    if (result.resourceType === 'sync_job_run') {
      const existingRun = await this.prisma.syncJobRun.findUnique({
        where: { id: result.resourceId },
        select: { syncJob: { select: { workspaceId: true } } },
      });
      if (!existingRun || existingRun.syncJob.workspaceId !== callingWorkspaceId) {
        this.logCrossWorkspaceAttempt(nodeId, result.resourceType, result.resourceId);
        return;
      }
      const run = await this.prisma.syncJobRun.update({
        where: { id: result.resourceId },
        data: {
          status: result.success ? 'success' : 'failed',
          finishedAt: new Date(),
          bytesTransferred: result.success ? 500000000 : 0,
          log: result.message,
        },
        include: { syncJob: true },
      });
      await this.prisma.syncJob.update({
        where: { id: run.syncJobId },
        data: { status: result.success ? 'success' : 'failed', lastRunAt: new Date() },
      });

      if (!result.success) {
        const errorMessage = this.normalizeFailureMessage(result.message);
        this.logger.error(`Sync job run ${run.id} (${run.syncJob.name}) failed: ${errorMessage}`);
        await this.createSyncJobFailureAlert({
          syncJobId: run.syncJobId,
          syncJobName: run.syncJob.name,
          nodeId: run.syncJob.nodeId,
          errorMessage,
        });
      }
      return;
    }

    if (result.resourceType === 'directory_list') {
      const pending = this.pendingDirectoryRequests.get(result.resourceId);
      if (!pending || pending.nodeId !== nodeId) {
        if (pending) this.logCrossWorkspaceAttempt(nodeId, result.resourceType, result.resourceId);
        return;
      }

      clearTimeout(pending.timeout);
      this.pendingDirectoryRequests.delete(result.resourceId);

      if (!result.success) {
        pending.reject(new Error(result.message ?? 'failed to list directories'));
        return;
      }

      const payload = result.data;
      pending.resolve({
        basePath: payload?.basePath ?? '/',
        directories: Array.isArray(payload?.directories) ? payload.directories : [],
      });
      return;
    }

    if (result.resourceType === 'directory_scan') {
      const pending = this.pendingDirectoryScanRequests.get(result.resourceId);
      if (!pending || pending.nodeId !== nodeId) {
        if (pending) this.logCrossWorkspaceAttempt(nodeId, result.resourceType, result.resourceId);
        return;
      }

      clearTimeout(pending.timeout);
      this.pendingDirectoryScanRequests.delete(result.resourceId);

      if (!result.success) {
        pending.reject(new Error(result.message ?? 'failed to scan directories'));
        return;
      }

      const payload = result.data;
      pending.resolve({
        basePath: payload?.basePath ?? '/',
        entries: Array.isArray(payload?.entries)
          ? payload.entries
              .filter((entry): entry is { path: string; sizeBytes: number } =>
                Boolean(entry) &&
                typeof entry.path === 'string' &&
                typeof entry.sizeBytes === 'number',
              )
              .map((entry) => ({ path: entry.path, sizeBytes: entry.sizeBytes }))
          : [],
        truncated: Boolean(payload?.truncated),
      });
      return;
    }

    if (result.resourceType === 'ping') {
      const pending = this.pendingPingRequests.get(result.resourceId);
      if (!pending || pending.nodeId !== nodeId) {
        if (pending) this.logCrossWorkspaceAttempt(nodeId, result.resourceType, result.resourceId);
        return;
      }
      clearTimeout(pending.timeout);
      this.pendingPingRequests.delete(result.resourceId);
      if (!result.success) {
        pending.reject(new Error(result.message ?? 'ping failed'));
        return;
      }
      const payload = result.data as Partial<PingResult> | undefined;
      const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
      pending.resolve({
        targetIp: payload?.targetIp ?? '',
        sent: number(payload?.sent) ?? 0,
        packetLoss: number(payload?.packetLoss) ?? 100,
        minMs: number(payload?.minMs),
        avgMs: number(payload?.avgMs),
        maxMs: number(payload?.maxMs),
      });
      return;
    }

    // An agent that predates on-demand ping answers with a bare "unknown
    // command": fail its pending pings now instead of after the timeout.
    if (!result.success && result.message?.includes('unknown command command.run_ping')) {
      for (const [requestId, request] of this.pendingPingRequests.entries()) {
        if (request.nodeId !== nodeId) continue;
        clearTimeout(request.timeout);
        request.reject(new Error("Agent trop ancien pour le ping à la demande : mettez-le à jour depuis la page Nœuds."));
        this.pendingPingRequests.delete(requestId);
      }
      return;
    }

    if (result.resourceType === 'traceroute') {
      const pending = this.pendingTracerouteRequests.get(result.resourceId);
      if (!pending || pending.nodeId !== nodeId) {
        if (pending) this.logCrossWorkspaceAttempt(nodeId, result.resourceType, result.resourceId);
        return;
      }

      clearTimeout(pending.timeout);
      this.pendingTracerouteRequests.delete(result.resourceId);

      if (!result.success) {
        pending.reject(new Error(result.message ?? 'traceroute failed'));
        return;
      }

      const payload = result.data;
      pending.resolve({
        targetIp: payload?.targetIp ?? '',
        hops: Array.isArray(payload?.hops)
          ? payload.hops
              .filter(
                (hop): hop is { hop: number; ip: string | null; latencyMs: number | null } =>
                  Boolean(hop) && typeof hop.hop === 'number',
              )
              .map((hop) => ({
                hop: hop.hop,
                ip: typeof hop.ip === 'string' ? hop.ip : null,
                latencyMs: typeof hop.latencyMs === 'number' ? hop.latencyMs : null,
              }))
          : [],
      });
      return;
    }

    if (result.resourceType === 'migration') {
      if (result.command === 'stop_rsync') {
        return;
      }
      const existingMigration = await this.prisma.migrationTask.findUnique({
        where: { id: result.resourceId },
        select: { workspaceId: true },
      });
      if (!existingMigration || existingMigration.workspaceId !== callingWorkspaceId) {
        this.logCrossWorkspaceAttempt(nodeId, result.resourceType, result.resourceId);
        return;
      }
      const updatedMigration = await this.prisma.migrationTask.update({
        where: { id: result.resourceId },
        data: result.success
          ? { status: 'completed', progress: 100, completedAt: new Date() }
          : { status: 'failed', completedAt: new Date() },
        include: {
          sourceNode: { select: { name: true } },
          targetNode: { select: { name: true } },
        },
      });

      if (!result.success) {
        const errorMessage = this.normalizeFailureMessage(result.message);
        this.logger.error(
          `Migration ${updatedMigration.id} failed at ${updatedMigration.progress}%: ${errorMessage}`,
        );
        await this.createMigrationFailureAlert({
          migrationId: updatedMigration.id,
          migrationName: updatedMigration.name,
          nodeId: updatedMigration.targetNodeId ?? updatedMigration.sourceNodeId ?? null,
          sourceName: updatedMigration.sourceNode?.name,
          targetName: updatedMigration.targetNode?.name,
          progress: updatedMigration.progress,
          errorMessage,
        });
      }
      return;
    }

    if (result.resourceType === 'agent') {
      this.logger.log(`Agent ${result.command} on node ${result.resourceId}: ${result.message ?? '(no message)'}`);
      return;
    }

    // Agents built before the VPN feature answer apply_vpn with a bare
    // "unknown command" (no resourceType, no revision): surface it as an
    // apply error telling the operator what to do, instead of leaving the
    // node's profiles "pending" forever. The update reconnects the agent,
    // which re-triggers a full VPN apply (VpnService.onAgentConnected).
    if (!result.success && result.message?.includes('unknown command command.apply_vpn')) {
      await this.vpnService.onApplyResult(nodeId, callingWorkspaceId, {
        revision: new Date().toISOString(),
        success: false,
        message: "Agent trop ancien pour le VPN : mettez à jour l'agent de ce nœud depuis la page Nœuds.",
      });
      return;
    }

    // resourceId is the apply's revision - see VpnService.reconcileWorkspace.
    if (result.resourceType === 'vpn') {
      await this.vpnService.onApplyResult(nodeId, callingWorkspaceId, {
        revision: result.resourceId,
        success: result.success,
        message: result.message,
        active: result.data?.vpnActive,
        policy: result.data?.vpnPolicy,
      });
      return;
    }
  }

  async onCommandProgress(nodeId: string, progress: CommandProgressPayload) {
    const normalized = Math.max(0, Math.min(100, Math.round(progress.progress)));
    const callingWorkspaceId = await this.resolveCallingNodeWorkspace(nodeId);
    if (!callingWorkspaceId) {
      this.logger.warn(`Command progress from unknown node ${nodeId} - ignored`);
      return;
    }

    if (progress.resourceType === 'sync_job_run') {
      const existingRun = await this.prisma.syncJobRun.findUnique({
        where: { id: progress.resourceId },
        select: { syncJob: { select: { workspaceId: true } } },
      });
      if (!existingRun || existingRun.syncJob.workspaceId !== callingWorkspaceId) {
        this.logCrossWorkspaceAttempt(nodeId, progress.resourceType, progress.resourceId);
        return;
      }
      await this.prisma.syncJobRun.update({
        where: { id: progress.resourceId },
        data: { bytesTransferred: normalized * 5_000_000 },
      });
      return;
    }

    if (progress.resourceType === 'migration') {
      const existingMigration = await this.prisma.migrationTask.findUnique({
        where: { id: progress.resourceId },
        select: { workspaceId: true },
      });
      if (!existingMigration || existingMigration.workspaceId !== callingWorkspaceId) {
        this.logCrossWorkspaceAttempt(nodeId, progress.resourceType, progress.resourceId);
        return;
      }
      await this.prisma.migrationTask.update({
        where: { id: progress.resourceId },
        data: {
          status: normalized >= 100 ? 'completed' : 'running',
          progress: normalized,
          ...(normalized >= 100 ? { completedAt: new Date() } : {}),
        },
      });
    }
  }

  sendCommand(nodeId: string, command: CommandPayload) {
    const sender = this.senders.get(nodeId);
    if (!sender) return false;

    sender('command', command);
    return true;
  }

  async triggerAgentUpdate(nodeId: string, options?: { ref?: string; repoUrl?: string; serviceName?: string }) {
    const node = await this.prisma.node.findUnique({ where: { id: nodeId }, select: { id: true } });
    if (!node) {
      throw new NotFoundException('node not found');
    }

    const sent = this.sendCommand(nodeId, {
      type: 'command.update_agent',
      payload: {
        nodeId,
        ref: options?.ref,
        repoUrl: options?.repoUrl,
        serviceName: options?.serviceName,
      },
    });

    if (!sent) {
      return { queued: false as const, message: 'node is offline' };
    }

    return { queued: true as const, message: 'agent update command sent' };
  }

  /**
   * Best-effort: asks the still-connected agent to tear itself down
   * (systemd unit, WireGuard interface, managed SSH keys, binaries, worktree)
   * before its node record is deleted. If the agent is offline the command
   * is simply dropped — deletion proceeds regardless since the DB record is
   * the source of truth for the dashboard.
   */
  triggerAgentUninstall(nodeId: string) {
    const sent = this.sendCommand(nodeId, {
      type: 'command.uninstall_agent',
      payload: { nodeId },
    });

    return sent
      ? { queued: true as const, message: 'agent uninstall command sent' }
      : { queued: false as const, message: 'node is offline' };
  }

  requestDirectories(nodeId: string, basePath = '/', timeoutMs = 5000): Promise<{ basePath: string; directories: string[] }> {
    const requestId = `dirs:${nodeId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingDirectoryRequests.delete(requestId);
        reject(new Error('directory listing timeout'));
      }, timeoutMs);

      this.pendingDirectoryRequests.set(requestId, {
        nodeId,
        resolve,
        reject,
        timeout,
      });

      const sent = this.sendCommand(nodeId, {
        type: 'command.list_directories',
        payload: { requestId, basePath },
      });

      if (!sent) {
        clearTimeout(timeout);
        this.pendingDirectoryRequests.delete(requestId);
        reject(new Error(`node ${nodeId} is offline`));
      }
    });
  }

  requestDirectoryScan(nodeId: string, basePath = '/', maxEntries = 20, timeoutMs = 7000): Promise<{
    basePath: string;
    entries: Array<{ path: string; sizeBytes: number }>;
    truncated: boolean;
  }> {
    const requestId = `scan:${nodeId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    const boundedMaxEntries = Math.max(1, Math.min(maxEntries, 100));

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingDirectoryScanRequests.delete(requestId);
        reject(new Error('directory scan timeout'));
      }, timeoutMs);

      this.pendingDirectoryScanRequests.set(requestId, {
        nodeId,
        resolve,
        reject,
        timeout,
      });

      const sent = this.sendCommand(nodeId, {
        type: 'command.scan_directory_sizes',
        payload: { requestId, basePath, maxEntries: boundedMaxEntries },
      });

      if (!sent) {
        clearTimeout(timeout);
        this.pendingDirectoryScanRequests.delete(requestId);
        reject(new Error(`node ${nodeId} is offline`));
      }
    });
  }

  requestRemoteDirectories(
    nodeId: string,
    payload: {
      host: string;
      username: string;
      password?: string;
      port?: number;
      basePath?: string;
      endpointType?: 'seedbox' | 'storagebox';
    },
    timeoutMs = 7000,
  ): Promise<{ basePath: string; directories: string[] }> {
    const requestId = `rdirs:${nodeId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingDirectoryRequests.delete(requestId);
        reject(new Error('remote directory listing timeout'));
      }, timeoutMs);

      this.pendingDirectoryRequests.set(requestId, {
        nodeId,
        resolve,
        reject,
        timeout,
      });

      const sent = this.sendCommand(nodeId, {
        type: 'command.list_remote_directories',
        payload: {
          requestId,
          host: payload.host,
          username: payload.username,
          password: payload.password,
          port: payload.port,
          basePath: payload.basePath ?? '/',
          endpointType: payload.endpointType,
        },
      });

      if (!sent) {
        clearTimeout(timeout);
        this.pendingDirectoryRequests.delete(requestId);
        reject(new Error(`node ${nodeId} is offline`));
      }
    });
  }

  requestTraceroute(
    nodeId: string,
    targetIp: string,
    timeoutMs = 15000,
  ): Promise<{ targetIp: string; hops: Array<{ hop: number; ip: string | null; latencyMs: number | null }> }> {
    const requestId = `trace:${nodeId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingTracerouteRequests.delete(requestId);
        reject(new Error('traceroute timeout'));
      }, timeoutMs);

      this.pendingTracerouteRequests.set(requestId, {
        nodeId,
        resolve,
        reject,
        timeout,
      });

      const sent = this.sendCommand(nodeId, {
        type: 'command.run_traceroute',
        payload: { requestId, targetIp },
      });

      if (!sent) {
        clearTimeout(timeout);
        this.pendingTracerouteRequests.delete(requestId);
        reject(new Error(`node ${nodeId} is offline`));
      }
    });
  }

  requestPing(nodeId: string, targetIp: string, timeoutMs = 12000): Promise<PingResult> {
    const requestId = `ping:${nodeId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingPingRequests.delete(requestId);
        reject(new Error("l'agent n'a pas répondu à temps"));
      }, timeoutMs);
      this.pendingPingRequests.set(requestId, { nodeId, resolve, reject, timeout });
      const sent = this.sendCommand(nodeId, { type: 'command.run_ping', payload: { requestId, targetIp } });
      if (!sent) {
        clearTimeout(timeout);
        this.pendingPingRequests.delete(requestId);
        reject(new Error(`node ${nodeId} is offline`));
      }
    });
  }

  // DS/DNSKEY records are never persisted (see DnsZone.dnssecEnabled) -
  // fetched live from the primary node's PowerDNS instance every time the
  // UI needs them, same request/response-over-WS shape as requestTraceroute.
  requestDnsZoneKeys(
    nodeId: string,
    zoneName: string,
    timeoutMs = 15000,
  ): Promise<{ dsRecords: string[]; dnskeyRecords: string[] }> {
    const requestId = `dns-keys:${nodeId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingDnsZoneKeysRequests.delete(requestId);
        reject(new Error('dnssec key fetch timeout'));
      }, timeoutMs);

      this.pendingDnsZoneKeysRequests.set(requestId, { nodeId, resolve, reject, timeout });

      const sent = this.sendCommand(nodeId, {
        type: 'command.dns_get_zone_keys',
        payload: { requestId, zoneName },
      });

      if (!sent) {
        clearTimeout(timeout);
        this.pendingDnsZoneKeysRequests.delete(requestId);
        reject(new Error(`node ${nodeId} is offline`));
      }
    });
  }

  async handleAgentUninstall(nodeId: string) {
    const memberships = await this.prisma.vlanMember.findMany({
      where: { nodeId },
      select: { vlanId: true },
    });
    const affectedVlanIds = Array.from(new Set(memberships.map((m) => m.vlanId)));

    await this.prisma.$transaction([
      this.prisma.vlanConnection.deleteMany({
        where: {
          OR: [{ sourceNodeId: nodeId }, { targetNodeId: nodeId }],
        },
      }),
      this.prisma.vlanMember.deleteMany({ where: { nodeId } }),
      this.prisma.node.updateMany({
        where: { id: nodeId },
        data: {
          status: 'offline',
          overlayPublicKey: null,
          overlayEndpoint: null,
          overlayListenPort: null,
          overlaySshPublicKey: null,
          overlaySshUser: null,
          vlanIp: null,
          vlanMac: null,
        },
      }),
    ]);

    this.unregister(nodeId);

    for (const vlanId of affectedVlanIds) {
      await this.reconcileOverlayForVlan(vlanId);
    }
  }

  private async reconcileOverlayForNode(nodeId: string) {
    const membership = await this.prisma.vlanMember.findFirst({ where: { nodeId } });
    if (!membership) return;
    await this.reconcileOverlayForVlan(membership.vlanId);
  }

  /**
   * Computes and pushes WireGuard peer config for every member of a VLAN.
   *
   * Members in the same region (or where region can't be resolved on either
   * side) stay fully meshed — direct /32 peers, exactly like before regional
   * segmentation existed. A cross-region pair is only routed through
   * gateways when BOTH regions have one designated (Node.overlayIsGateway);
   * otherwise it also falls back to a direct peer. This means: with no
   * gateway designated anywhere (today's state for an all-France fleet),
   * every pair takes the direct-peer path and output is identical to the
   * pre-segmentation implementation.
   */
  async reconcileOverlayForVlan(vlanId: string): Promise<void> {
    try {
      const members = await this.prisma.vlanMember.findMany({
        where: { vlanId },
        include: { node: true },
      });

      const regionByNodeId = new Map<string, Region | null>();
      for (const member of members) {
        regionByNodeId.set(member.nodeId, resolveRegion(member.node.locationCountryCode));
      }

      const gatewayByRegion = new Map<Region, (typeof members)[number]>();
      for (const member of members) {
        const region = regionByNodeId.get(member.nodeId);
        if (region && member.node.overlayIsGateway) {
          gatewayByRegion.set(region, member);
        }
      }

      for (const member of members) {
        if (!member.node.vlanIp || !member.node.overlayPublicKey) {
          continue;
        }

        const region = regionByNodeId.get(member.nodeId) ?? null;
        const localGateway = region ? gatewayByRegion.get(region) : undefined;
        const isGateway = Boolean(localGateway && localGateway.nodeId === member.nodeId);

        const eligibleCandidates = members.filter(
          (candidate) =>
            candidate.nodeId !== member.nodeId &&
            Boolean(candidate.node.vlanIp) &&
            Boolean(candidate.node.overlayPublicKey) &&
            Boolean(candidate.node.overlayEndpoint),
        );

        type Peer = {
          nodeId: string;
          publicKey: string;
          endpoint: string;
          allowedIps: string[];
          persistentKeepalive: number;
        };
        const peers: Peer[] = [];
        const peerByNodeId = new Map<string, Peer>();

        for (const candidate of eligibleCandidates) {
          const candidateRegion = regionByNodeId.get(candidate.nodeId) ?? null;
          const sameRegion = !region || !candidateRegion || region === candidateRegion;
          const remoteGateway = sameRegion ? undefined : gatewayByRegion.get(candidateRegion as Region);
          const segmented = !sameRegion && Boolean(localGateway) && Boolean(remoteGateway);

          if (!segmented || !remoteGateway) {
            // Same region, or cross-region without a gateway on both sides yet: unchanged full-mesh behavior.
            const peer: Peer = {
              nodeId: candidate.nodeId,
              publicKey: candidate.node.overlayPublicKey as string,
              endpoint: candidate.node.overlayEndpoint as string,
              allowedIps: [`${candidate.node.vlanIp}/32`],
              persistentKeepalive: 25,
            };
            peers.push(peer);
            peerByNodeId.set(candidate.nodeId, peer);
            continue;
          }

          if (isGateway) {
            // Only a single peer to the remote gateway, carrying the whole remote region's hosts.
            if (candidate.nodeId === remoteGateway.nodeId) {
              const remoteRegionIps = members
                .filter((m) => regionByNodeId.get(m.nodeId) === candidateRegion && m.node.vlanIp)
                .map((m) => `${m.node.vlanIp}/32`);
              const peer: Peer = {
                nodeId: candidate.nodeId,
                publicKey: candidate.node.overlayPublicKey as string,
                endpoint: candidate.node.overlayEndpoint as string,
                allowedIps: remoteRegionIps,
                persistentKeepalive: 25,
              };
              peers.push(peer);
              peerByNodeId.set(candidate.nodeId, peer);
            }
            // Individual remote members are reached via the remote gateway peer above, not directly.
            continue;
          }
          // Not a gateway: no direct peer into the other region at all — routed via the local
          // gateway peer entry instead (augmented below).
        }

        if (!isGateway && localGateway) {
          const localGatewayPeer = peerByNodeId.get(localGateway.nodeId);
          if (localGatewayPeer) {
            for (const otherRegion of gatewayByRegion.keys()) {
              if (otherRegion === region) continue;
              const remoteRegionIps = members
                .filter((m) => regionByNodeId.get(m.nodeId) === otherRegion && m.node.vlanIp)
                .map((m) => `${m.node.vlanIp}/32`);
              if (remoteRegionIps.length > 0) {
                localGatewayPeer.allowedIps.push(...remoteRegionIps);
              }
            }
          }
        }

        const authorizedKeys = members
          .filter((candidate) => candidate.nodeId !== member.nodeId && Boolean(candidate.node.overlaySshPublicKey))
          .map((candidate) => candidate.node.overlaySshPublicKey as string);

        const command: CommandPayload = {
          type: 'command.apply_overlay',
          payload: {
            interfaceName: 'tarmacwg0',
            addressCidr: `${member.node.vlanIp}/24`,
            listenPort: member.node.overlayListenPort ?? 51820,
            peers,
            ipForward: isGateway,
          },
        };

        this.sendCommand(member.nodeId, command);
        if (authorizedKeys.length > 0) {
          this.sendCommand(member.nodeId, {
            type: 'command.apply_ssh_authorized_keys',
            payload: {
              user: member.node.overlaySshUser ?? 'root',
              authorizedKeys,
            },
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to reconcile overlay for VLAN ${vlanId}:`, error);
      await this.createSystemAlert(`Overlay reconcile failed for VLAN ${vlanId}: ${message}`, 'medium');
    }
  }

  private async ingestOverlayLinkMetrics(
    sourceNodeId: string,
    linkMetrics: NonNullable<HeartbeatPayload['linkMetrics']>,
  ) {
    const sourceMembership = await this.prisma.vlanMember.findFirst({
      where: { nodeId: sourceNodeId },
      select: { vlanId: true, node: { select: { locationCountryCode: true } } },
    });
    if (!sourceMembership) return;
    const sourceRegion = resolveRegion(sourceMembership.node.locationCountryCode);

    const publicKeys = Array.from(
      new Set(linkMetrics.map((metric) => metric.targetPublicKey).filter((value): value is string => Boolean(value))),
    );
    const targetVlanIps = Array.from(
      new Set(linkMetrics.map((metric) => metric.targetVlanIp).filter((value): value is string => Boolean(value))),
    );

    if (publicKeys.length === 0 && targetVlanIps.length === 0) return;

    const [targetNodesByKey, vlanMembers] = await Promise.all([
      publicKeys.length > 0
        ? this.prisma.node.findMany({
            where: {
              overlayPublicKey: { in: publicKeys },
            },
            select: {
              id: true,
              status: true,
              overlayPublicKey: true,
              vlanIp: true,
              locationCountryCode: true,
            },
          })
        : Promise.resolve([]),
      this.prisma.vlanMember.findMany({
        where: { vlanId: sourceMembership.vlanId },
        include: {
          node: {
            select: {
              id: true,
              status: true,
              overlayPublicKey: true,
              vlanIp: true,
              locationCountryCode: true,
            },
          },
        },
      }),
    ]);

    const targetNodes = [
      ...targetNodesByKey,
      ...vlanMembers.map((member) => member.node),
    ];
    const nodeByPublicKey = new Map(
      targetNodes
        .filter(
          (node): node is {
            id: string;
            status: 'online' | 'offline' | 'degraded';
            overlayPublicKey: string;
            vlanIp: string | null;
            locationCountryCode: string | null;
          } =>
          Boolean(node.overlayPublicKey),
        )
        .map((node) => [node.overlayPublicKey, node]),
    );
    const nodeByVlanIp = new Map(
      targetNodes
        .filter(
          (node): node is {
            id: string;
            status: 'online' | 'offline' | 'degraded';
            overlayPublicKey: string | null;
            vlanIp: string;
            locationCountryCode: string | null;
          } => Boolean(node.vlanIp),
        )
        .map((node) => [node.vlanIp, node]),
    );

    const updates = linkMetrics.flatMap((metric) => {
      const target = nodeByPublicKey.get(metric.targetPublicKey) ?? (metric.targetVlanIp ? nodeByVlanIp.get(metric.targetVlanIp) : undefined);
      if (!target || target.id === sourceNodeId) return [];

      const txMbps = metric.txMbps ?? 0;
      const rxMbps = metric.rxMbps ?? 0;
      const handshakeAgeSec = metric.handshakeAgeSec;

      const hasTraffic = txMbps > 0 || rxMbps > 0;
      const hasUsableProbe =
        metric.packetLoss !== undefined ||
        (metric.latencyMs !== undefined && metric.latencyMs > 0);
      const handshakeUnknown = handshakeAgeSec === undefined || handshakeAgeSec < 0;
      const handshakeOffline = handshakeAgeSec !== undefined && handshakeAgeSec >= LINK_OFFLINE_HANDSHAKE_SEC;
      const handshakeDegraded =
        handshakeAgeSec !== undefined &&
        handshakeAgeSec >= LINK_DEGRADED_HANDSHAKE_SEC &&
        handshakeAgeSec < LINK_OFFLINE_HANDSHAKE_SEC;
      const peerReportedOffline = target.status !== 'online';

      // A link crossing regions (e.g. the France <-> Canada gateway backbone)
      // has a much higher latency floor than an intra-region link purely from
      // physical distance — don't flag that baseline as degraded.
      const targetRegion = resolveRegion(target.locationCountryCode);
      const isCrossRegionLink = Boolean(sourceRegion && targetRegion && sourceRegion !== targetRegion);
      const latencyDegradedThresholdMs = isCrossRegionLink
        ? LINK_DEGRADED_LATENCY_CROSS_REGION_MS
        : LINK_DEGRADED_LATENCY_MS;

      const status: 'healthy' | 'degraded' | 'offline' =
        // Only classify as offline from hard link telemetry signals.
        // Node status can be stale while tunnel traffic/probes are actually healthy.
        (handshakeOffline && !hasTraffic && !hasUsableProbe)
          ? 'offline'
          : peerReportedOffline ||
              (handshakeUnknown && !hasTraffic && !hasUsableProbe) ||
              (handshakeDegraded && !hasTraffic && !hasUsableProbe) ||
              (metric.packetLoss ?? 0) >= 8 ||
              (metric.latencyMs ?? 0) >= latencyDegradedThresholdMs
            ? 'degraded'
            : 'healthy';

      const commonData = {
        status,
        lastCheckedAt: new Date(),
      };
      const measuredLatencyMs =
        metric.latencyMs !== undefined && Number.isFinite(metric.latencyMs) ? metric.latencyMs : undefined;
      const measuredPacketLoss =
        metric.packetLoss !== undefined && Number.isFinite(metric.packetLoss)
          ? metric.packetLoss
          : undefined;
      const measuredTxMbps = Math.max(0, txMbps);
      const measuredRxMbps = Math.max(0, rxMbps);

      return [
        {
          sourceNodeId,
          targetNodeId: target.id,
          data: {
            ...commonData,
            bandwidth: measuredTxMbps,
            latencyMs: measuredLatencyMs ?? null,
            packetLoss: measuredPacketLoss ?? null,
          },
        },
        {
          sourceNodeId: target.id,
          targetNodeId: sourceNodeId,
          data: {
            ...commonData,
            bandwidth: measuredRxMbps,
          },
        },
      ];
    });

    if (updates.length > 0) {
      const dedupedUpdates = new Map<
        string,
        {
          sourceNodeId: string;
          targetNodeId: string;
          data: {
            status: 'healthy' | 'degraded' | 'offline';
            lastCheckedAt: Date;
            bandwidth: number;
            latencyMs?: number | null;
            packetLoss?: number | null;
          };
        }
      >();
      for (const update of updates) {
        const key = `${update.sourceNodeId}:${update.targetNodeId}`;
        dedupedUpdates.set(key, update);
      }

      const sortedUpdates = Array.from(dedupedUpdates.values()).sort((a, b) => {
        const sourceComparison = a.sourceNodeId.localeCompare(b.sourceNodeId);
        if (sourceComparison !== 0) return sourceComparison;
        return a.targetNodeId.localeCompare(b.targetNodeId);
      });

      const existingConnections = await this.prisma.vlanConnection.findMany({
        where: {
          vlanId: sourceMembership.vlanId,
          OR: sortedUpdates.map((update) => ({
            sourceNodeId: update.sourceNodeId,
            targetNodeId: update.targetNodeId,
          })),
        },
        select: { sourceNodeId: true, targetNodeId: true, status: true },
      });
      const previousStatusByPair = new Map(
        existingConnections.map((connection) => [`${connection.sourceNodeId}:${connection.targetNodeId}`, connection.status]),
      );

      // Concurrent, not sequential: this runs on every 5s heartbeat from
      // every node, and each pair is an independent row (unique per
      // vlanId+sourceNodeId+targetNodeId) with no ordering dependency on any
      // other pair - awaiting them one at a time here meant total DB
      // round-trips scaled with fleet size per heartbeat (O(N) per node,
      // ~O(N^2) fleet-wide every 5s in a full-mesh VLAN). Promise.all turns
      // that into one concurrent batch regardless of N.
      await Promise.all(
        sortedUpdates.map(async (update) => {
          await this.retryWithExponentialBackoff(
            () =>
              this.prisma.vlanConnection.upsert({
                where: {
                  vlanId_sourceNodeId_targetNodeId: {
                    vlanId: sourceMembership.vlanId,
                    sourceNodeId: update.sourceNodeId,
                    targetNodeId: update.targetNodeId,
                  },
                },
                update: update.data,
                create: {
                  vlanId: sourceMembership.vlanId,
                  sourceNodeId: update.sourceNodeId,
                  targetNodeId: update.targetNodeId,
                  ...update.data,
                },
              }),
            `upsert vlanConnection ${update.sourceNodeId}->${update.targetNodeId}`,
          );

          const previousStatus = previousStatusByPair.get(`${update.sourceNodeId}:${update.targetNodeId}`);
          await this.vlanService.recordConnectionTransition(
            sourceMembership.vlanId,
            update.sourceNodeId,
            update.targetNodeId,
            previousStatus,
            update.data,
          );
        }),
      );
    }
  }
}
