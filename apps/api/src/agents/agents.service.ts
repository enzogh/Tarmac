import { forwardRef, Inject, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { normalizePublicKey } from '../github/deploy-key-match';
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
import { classifyLink } from '../vlan/link-status';
import { planOverlayPeers, shouldUseBackup } from '../vlan/overlay-topology';
import { AgentLogsService } from '../agent-logs/agent-logs.service';
import { LiveWsServer } from '../live/live.ws';
import { DEFAULT_WORKSPACE_ID } from '../workspaces/default-workspace';
import { alertWorkspaceId } from '../alerts/alert-workspace';
import { getControlPlaneVersion, isKnownControlPlaneVersion } from '../common/build-info';
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
export type DnsZoneFingerprint = { serial: number; fingerprint: string; records: number };
type PendingDnsZoneFingerprintRequest = {
  nodeId: string;
  resolve: (value: DnsZoneFingerprint) => void;
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
// Every node is marked offline at boot until its agent reconnects: gateway
// failover waits this long so a slow-reconnecting primary isn't taken for dead.
const GATEWAY_FAILOVER_STARTUP_GRACE_MS = 3 * 60_000;
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

// An agent update fetches, compiles (up to 20 min on the agent side) and
// restarts: past these delays without news it is reported as stuck.
const AGENT_UPDATE_BUILD_TIMEOUT_MS = 25 * 60 * 1000;
const AGENT_UPDATE_RESTART_TIMEOUT_MS = 5 * 60 * 1000;

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
  private readonly pendingDnsZoneFingerprintRequests = new Map<string, PendingDnsZoneFingerprintRequest>();
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

  // workspaceId: the workspace the failure concerns - left out only for
  // platform-level failures, which go to the default workspace.
  private async createSystemAlert(
    message: string,
    severity: 'medium' | 'high' | 'critical' = 'high',
    workspaceId: string = DEFAULT_WORKSPACE_ID,
  ) {
    await this.prisma.alert.create({
      data: {
        workspaceId,
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
        workspaceId: await alertWorkspaceId(this.prisma, params.nodeId),
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
        workspaceId: await alertWorkspaceId(this.prisma, params.nodeId),
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
        workspaceId: await alertWorkspaceId(this.prisma, params.nodeId),
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
    // The conflict is re-reported on every DNS check (every 30 s): one open
    // alert per conflict is enough, not one per check.
    const existing = await this.prisma.alert.findFirst({
      where: { nodeId: params.nodeId, message, status: { not: 'resolved' } },
      select: { id: true },
    });
    if (existing) return;

    await this.prisma.alert.create({
      data: {
        workspaceId: await alertWorkspaceId(this.prisma, params.nodeId),
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
      select: { name: true, workspaceId: true, mutedUntil: true, smartMonitoringEnabled: true },
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
        workspaceId: node?.workspaceId ?? DEFAULT_WORKSPACE_ID,
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

  // A reconnecting agent registers its new socket before the old one's close
  // fires (it can take a ping timeout to notice). Passing the socket's own
  // sender keeps that late close from dropping the live one - which left the
  // node heartbeating as online while every command to it went nowhere.
  unregister(nodeId: string, send?: SendFn) {
    if (send && this.senders.get(nodeId) !== send) return;
    this.senders.delete(nodeId);
    this.appliedStates.delete(nodeId);
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
    for (const [requestId, request] of this.pendingDnsZoneFingerprintRequests.entries()) {
      if (request.nodeId !== nodeId) continue;
      clearTimeout(request.timeout);
      request.reject(new Error(`node ${nodeId} disconnected`));
      this.pendingDnsZoneFingerprintRequests.delete(requestId);
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

  // When each gateway was last seen coming back up, for the failback delay.
  private readonly gatewayUpSince = new Map<string, number>();
  private readonly bootedAt = Date.now();

  /**
   * Hands a region's gateway role to its backup while the primary is down,
   * and back once the primary has been stable for a while (shouldUseBackup).
   * Skipped right after boot: every node starts offline until its agent
   * reconnects, which would otherwise look like a dead primary.
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async checkGatewayFailover() {
    if (Date.now() - this.bootedAt < GATEWAY_FAILOVER_STARTUP_GRACE_MS) return;
    try {
      const members = await this.prisma.vlanMember.findMany({
        where: { OR: [{ node: { overlayIsGateway: true } }, { node: { overlayIsBackupGateway: true } }] },
        select: {
          vlanId: true,
          node: {
            select: {
              id: true,
              name: true,
              status: true,
              workspaceId: true,
              locationCountryCode: true,
              overlayIsGateway: true,
              overlayIsBackupGateway: true,
            },
          },
        },
      });
      const now = Date.now();
      const isUp = (node: { status: string }) => node.status !== 'offline';
      for (const { node } of members) {
        if (!isUp(node)) this.gatewayUpSince.delete(node.id);
        else if (!this.gatewayUpSince.has(node.id)) this.gatewayUpSince.set(node.id, now);
      }

      const byRegion = new Map<string, { vlanId: string; region: Region; primary?: (typeof members)[number]['node']; backup?: (typeof members)[number]['node'] }>();
      for (const { vlanId, node } of members) {
        const region = resolveRegion(node.locationCountryCode);
        if (!region) continue;
        const key = `${vlanId}:${region}`;
        const entry = byRegion.get(key) ?? { vlanId, region };
        if (node.overlayIsGateway) entry.primary = node;
        if (node.overlayIsBackupGateway) entry.backup = node;
        byRegion.set(key, entry);
      }

      const changedVlans = new Set<string>();
      for (const { vlanId, region, primary, backup } of byRegion.values()) {
        const usingBackup = this.vlanService.isFailedOver(vlanId, region);
        const next =
          primary && backup
            ? shouldUseBackup(usingBackup, isUp(primary), isUp(backup), now - (this.gatewayUpSince.get(primary.id) ?? now))
            : false;
        if (next === usingBackup) continue;
        this.vlanService.setFailedOver(vlanId, region, next);
        changedVlans.add(vlanId);
        const message = next
          ? `Passerelle ${primary!.name} injoignable : ${backup!.name} prend le relais pour sa région`
          : `Passerelle ${primary?.name ?? ''} de retour : elle reprend le relais${backup ? ` de ${backup.name}` : ''}`;
        this.logger.warn(message);
        await this.prisma.alert.create({
          data: {
            workspaceId: (primary ?? backup)!.workspaceId,
            nodeId: (primary ?? backup)!.id,
            severity: next ? 'high' : 'medium',
            message,
          },
        });
      }
      for (const vlanId of changedVlans) {
        await this.reconcileOverlayForVlan(vlanId);
      }
    } catch (error) {
      this.logger.error('Gateway failover check failed:', error);
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

  // nodeId -> kind -> stateHash, as last reported in the node's heartbeat.
  private readonly appliedStates = new Map<string, Record<string, string>>();

  /**
   * Hash of the desired state of `kind` this node reports as applied, so a
   * ticked push can skip nodes already there. Undefined until the node's
   * first heartbeat after connecting (and for agents that predate it).
   */
  appliedStateHash(nodeId: string, kind: string): string | undefined {
    return this.appliedStates.get(nodeId)?.[kind];
  }

  async onHeartbeat(nodeId: string, payload: HeartbeatPayload) {
    const { metrics, overlay, linkMetrics, vpnPeers, version, system } = payload;
    if (payload.appliedState && typeof payload.appliedState === 'object') {
      this.appliedStates.set(nodeId, payload.appliedState);
    } else {
      this.appliedStates.delete(nodeId);
    }
    const systemInfo = sanitizeSystemInfo(system);
    const dnsServerState = sanitizeDnsServerState(payload.dns);
    const deployKeyPublic = normalizePublicKey(payload.deployKey);
    if (dnsServerState) await this.alertOnDnsMaintenanceGiveUp(nodeId, dnsServerState);
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
          ...(systemInfo ? { systemInfo } : {}),
          dnsServerState: dnsServerState ? (dnsServerState as unknown as Prisma.InputJsonObject) : Prisma.DbNull,
          ...(deployKeyPublic ? { deployKeyPublic } : {}),
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

    if (version && (node.agentUpdateStatus === 'sent' || node.agentUpdateStatus === 'restarting')) {
      await this.closeAgentUpdateOnHeartbeat(node, version);
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
        system: systemInfo ?? null,
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

  private async isUnchangedInternalDnsRoute(nodeId: string, result: CommandResultPayload): Promise<boolean> {
    if (result.resourceType !== 'internal_dns_route' || !result.success || result.resourceId !== nodeId) {
      return false;
    }
    const status = (result.data as { status?: string } | undefined)?.status;
    if (!status) return false;
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
      select: { internalDnsForwarderStatus: true },
    });
    return node?.internalDnsForwarderStatus === status;
  }

  async onCommandResult(nodeId: string, result: CommandResultPayload) {
    if (await this.isUnchangedInternalDnsRoute(nodeId, result)) {
      // Re-sent to every node on InternalDnsService's 30 s self-heal tick:
      // an identical outcome is neither news for the node's log nor the UI.
      return;
    }
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

    if (result.command === 'update_agent') {
      await this.recordAgentUpdateResult(nodeId, callingWorkspaceId, result);
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
          'high',
          callingWorkspaceId,
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

    if (result.resourceType === 'dns_zone_fingerprint') {
      const pending = this.pendingDnsZoneFingerprintRequests.get(result.resourceId);
      if (!pending || pending.nodeId !== nodeId) {
        if (pending) this.logCrossWorkspaceAttempt(nodeId, result.resourceType, result.resourceId);
        return;
      }
      clearTimeout(pending.timeout);
      this.pendingDnsZoneFingerprintRequests.delete(result.resourceId);
      const data = result.data as { serial?: unknown; fingerprint?: unknown; records?: unknown } | undefined;
      if (!result.success || typeof data?.fingerprint !== 'string') {
        pending.reject(new Error(result.message ?? 'failed to fingerprint zone'));
        return;
      }
      pending.resolve({
        serial: typeof data.serial === 'number' ? data.serial : 0,
        fingerprint: data.fingerprint,
        records: typeof data.records === 'number' ? data.records : 0,
      });
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
    const node = await this.prisma.node.findUnique({ where: { id: nodeId }, select: { id: true, workspaceId: true, agentVersion: true } });
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

    const controlVersion = getControlPlaneVersion();
    await this.setAgentUpdate(nodeId, node.workspaceId, {
      agentUpdateStatus: 'sent',
      agentUpdateMessage: null,
      agentUpdateFromVersion: node.agentVersion,
      // A custom ref builds something else than the controller's version.
      agentUpdateToVersion: !options?.ref && isKnownControlPlaneVersion(controlVersion) ? controlVersion : null,
      agentUpdateStartedAt: new Date(),
      agentUpdateFinishedAt: null,
    });

    return { queued: true as const, message: 'agent update command sent' };
  }

  // --- agent update progress ------------------------------------------
  // sent (fetch + build on the node) -> restarting (binary replaced, service
  // restart scheduled) -> done once a heartbeat reports the new version.
  // failed / timeout carry a sentence the dashboard shows as-is.

  private async setAgentUpdate(nodeId: string, workspaceId: string, data: Prisma.NodeUpdateInput) {
    const node = await this.prisma.node.update({
      where: { id: nodeId },
      data,
      select: {
        agentUpdateStatus: true,
        agentUpdateMessage: true,
        agentUpdateFromVersion: true,
        agentUpdateToVersion: true,
        agentUpdateStartedAt: true,
        agentUpdateFinishedAt: true,
      },
    });
    this.live.broadcast(
      'agent.update',
      {
        nodeId,
        status: node.agentUpdateStatus,
        message: node.agentUpdateMessage,
        fromVersion: node.agentUpdateFromVersion,
        toVersion: node.agentUpdateToVersion,
        startedAt: node.agentUpdateStartedAt?.toISOString() ?? null,
        finishedAt: node.agentUpdateFinishedAt?.toISOString() ?? null,
      },
      workspaceId,
    );
  }

  private async recordAgentUpdateResult(nodeId: string, workspaceId: string, result: CommandResultPayload) {
    const node = await this.prisma.node.findUnique({ where: { id: nodeId }, select: { agentUpdateToVersion: true, agentUpdateStatus: true } });
    if (!node) return;
    if (!result.success) {
      await this.setAgentUpdate(nodeId, workspaceId, {
        agentUpdateStatus: 'failed',
        agentUpdateMessage: describeAgentUpdateFailure(result.message),
        agentUpdateFinishedAt: new Date(),
      });
      return;
    }
    const built = /\(version ([^)\s]+)\)/.exec(result.message ?? '')?.[1] ?? null;
    if (built && node.agentUpdateToVersion && built !== node.agentUpdateToVersion) {
      // The node built the tip of the repository, which is not what the
      // controller runs: the deployed commit was never pushed.
      await this.setAgentUpdate(nodeId, workspaceId, {
        agentUpdateStatus: 'failed',
        agentUpdateMessage: `L'agent a été recompilé en version ${built}, mais le contrôleur est en ${node.agentUpdateToVersion} : cette version n'est pas encore publiée sur le dépôt Git (push manquant ?). Publiez-la puis relancez la mise à jour.`,
        agentUpdateFinishedAt: new Date(),
      });
      return;
    }
    await this.setAgentUpdate(nodeId, workspaceId, {
      agentUpdateStatus: 'restarting',
      agentUpdateMessage: null,
      ...(built && !node.agentUpdateToVersion ? { agentUpdateToVersion: built } : {}),
    });
  }

  private async closeAgentUpdateOnHeartbeat(
    node: { id: string; workspaceId: string; agentUpdateStatus: string | null; agentUpdateFromVersion: string | null; agentUpdateToVersion: string | null },
    version: string,
  ) {
    const reached = node.agentUpdateToVersion ? version === node.agentUpdateToVersion : version !== node.agentUpdateFromVersion;
    if (!reached) return;
    await this.setAgentUpdate(node.id, node.workspaceId, {
      agentUpdateStatus: 'done',
      agentUpdateMessage: null,
      agentUpdateToVersion: version,
      agentUpdateFinishedAt: new Date(),
    });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async expireStuckAgentUpdates() {
    try {
      const now = Date.now();
      const stuck = await this.prisma.node.findMany({
        where: { agentUpdateStatus: { in: ['sent', 'restarting'] } },
        select: { id: true, workspaceId: true, agentUpdateStatus: true, agentUpdateStartedAt: true, updatedAt: true, status: true },
      });
      for (const node of stuck) {
        const started = node.agentUpdateStartedAt?.getTime() ?? 0;
        if (node.agentUpdateStatus === 'sent' && now - started > AGENT_UPDATE_BUILD_TIMEOUT_MS) {
          await this.setAgentUpdate(node.id, node.workspaceId, {
            agentUpdateStatus: 'timeout',
            agentUpdateMessage:
              node.status === 'online'
                ? "L'agent n'a pas confirmé la mise à jour après 25 minutes. Consultez ses logs (Journal → Agents), puis relancez."
                : "Le nœud s'est déconnecté pendant la mise à jour et n'est pas revenu. Vérifiez le service tarmac-agent sur le serveur.",
            agentUpdateFinishedAt: new Date(),
          });
        } else if (node.agentUpdateStatus === 'restarting' && now - Math.max(started, node.updatedAt.getTime()) > AGENT_UPDATE_RESTART_TIMEOUT_MS) {
          await this.setAgentUpdate(node.id, node.workspaceId, {
            agentUpdateStatus: 'timeout',
            agentUpdateMessage:
              "Le nouvel agent est installé mais ne s'est pas reconnecté avec sa nouvelle version. Vérifiez le service tarmac-agent sur le serveur (systemctl status tarmac-agent).",
            agentUpdateFinishedAt: new Date(),
          });
        }
      }
    } catch (error) {
      this.logger.warn(`Agent update expiry check failed: ${error instanceof Error ? error.message : error}`);
    }
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
    // The agent gives up after 15 hops or 4 silent ones (1 s each), and its
    // system-tool fallback after 18 s: this only catches a vanished agent.
    timeoutMs = 25000,
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

  // The zone's content as one server holds it, hashed by its agent - lets
  // the sync check compare primary and secondaries beyond the SOA serial.
  requestDnsZoneFingerprint(nodeId: string, zoneName: string, timeoutMs = 15000): Promise<DnsZoneFingerprint> {
    const requestId = `dns-fp:${nodeId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingDnsZoneFingerprintRequests.delete(requestId);
        reject(new Error('zone fingerprint timeout'));
      }, timeoutMs);

      this.pendingDnsZoneFingerprintRequests.set(requestId, { nodeId, resolve, reject, timeout });

      const sent = this.sendCommand(nodeId, {
        type: 'command.dns_zone_fingerprint',
        payload: { requestId, zoneName },
      });

      if (!sent) {
        clearTimeout(timeout);
        this.pendingDnsZoneFingerprintRequests.delete(requestId);
        reject(new Error(`node ${nodeId} is offline`));
      }
    });
  }

  // One alert when the agent stops retrying a PowerDNS maintenance task on
  // its own - from then on nothing happens until someone retries it.
  private async alertOnDnsMaintenanceGiveUp(nodeId: string, state: DnsServerState) {
    const gaveUp = (s: DnsServerState | null, task: string) => {
      const entry = s?.tasks[task];
      return !!entry && entry.status === 'failed' && entry.attempts >= s!.maxAttempts;
    };
    const tasks = Object.keys(state.tasks).filter((task) => gaveUp(state, task));
    if (tasks.length === 0) return;
    const node = await this.prisma.node.findUnique({ where: { id: nodeId }, select: { name: true, workspaceId: true, dnsServerState: true } });
    if (!node) return;
    const previous = node.dnsServerState as DnsServerState | null;
    for (const task of tasks) {
      if (gaveUp(previous, task)) continue;
      const label = task === 'upgrade' ? 'La mise à jour de PowerDNS' : 'La migration de la base PowerDNS vers lmdb';
      await this.prisma.alert.create({
        data: {
          workspaceId: node.workspaceId,
          nodeId,
          severity: 'high',
          message: `${label} a échoué ${state.maxAttempts} fois sur ${node.name} : l'agent ne réessaiera plus seul. Dernière erreur : ${state.tasks[task].error ?? 'inconnue'}`,
        },
      });
    }
  }

  // Runs the node's PowerDNS maintenance now: the version upgrade when
  // asked, or a retry of a task the agent gave up on.
  requestDnsMaintenance(nodeId: string, upgrade: boolean) {
    return this.sendCommand(nodeId, { type: 'command.dns_maintenance', payload: { upgrade } });
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
   * Computes and pushes WireGuard peer config for every member of a VLAN -
   * see planOverlayPeers for the segmentation rules. Each region is carried
   * by its active gateway: the designated primary, or its backup while
   * checkGatewayFailover has failed the region over.
   */
  async reconcileOverlayForVlan(vlanId: string): Promise<void> {
    try {
      const members = await this.prisma.vlanMember.findMany({
        where: { vlanId },
        include: { node: true },
      });

      const gatewayByRegion = this.vlanService.activeGatewaysFor(
        vlanId,
        members.map((member) => member.node),
      );
      const plans = planOverlayPeers(
        members.map((member) => ({
          nodeId: member.nodeId,
          region: resolveRegion(member.node.locationCountryCode),
          vlanIp: member.node.vlanIp,
          overlayPublicKey: member.node.overlayPublicKey,
          overlayEndpoint: member.node.overlayEndpoint,
        })),
        gatewayByRegion,
      );

      for (const { nodeId, peers, ipForward } of plans) {
        const member = members.find((candidate) => candidate.nodeId === nodeId)!;
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
            ipForward,
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
      const vlan = await this.prisma.vlan.findUnique({ where: { id: vlanId }, select: { workspaceId: true } }).catch(() => null);
      await this.createSystemAlert(`Overlay reconcile failed for VLAN ${vlanId}: ${message}`, 'medium', vlan?.workspaceId);
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
      const targetRegion = resolveRegion(target.locationCountryCode);
      const status = classifyLink(metric, {
        peerOnline: target.status === 'online',
        // A link crossing regions (e.g. the France <-> Canada gateway
        // backbone) has a much higher latency floor from distance alone.
        crossRegion: Boolean(sourceRegion && targetRegion && sourceRegion !== targetRegion),
      });

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

// Keeps only the known fields, with the expected types: this lands in the
// database and in every dashboard as-is.
export type DnsServerTask = { status: string; attempts: number; error: string | null; updatedAt: string | null };
export type DnsServerState = {
  pdnsVersion: string;
  backend: string;
  catalog: boolean;
  maxAttempts: number;
  tasks: Record<string, DnsServerTask>;
};

function sanitizeDnsServerState(raw: unknown): DnsServerState | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');
  const tasks: Record<string, DnsServerTask> = {};
  if (source.tasks && typeof source.tasks === 'object') {
    for (const name of ['lmdb', 'upgrade']) {
      const task = (source.tasks as Record<string, unknown>)[name];
      if (!task || typeof task !== 'object') continue;
      const entry = task as Record<string, unknown>;
      tasks[name] = {
        status: text(entry.status, 20),
        attempts: typeof entry.attempts === 'number' && entry.attempts >= 0 ? entry.attempts : 0,
        error: text(entry.error, 600) || null,
        updatedAt: text(entry.updatedAt, 40) || null,
      };
    }
  }
  return {
    pdnsVersion: text(source.pdnsVersion, 60),
    backend: text(source.backend, 20),
    catalog: source.catalog === true,
    maxAttempts: typeof source.maxAttempts === 'number' && source.maxAttempts > 0 ? source.maxAttempts : 3,
    tasks,
  };
}

function sanitizeSystemInfo(raw: unknown): Prisma.InputJsonObject | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const out: Record<string, string | number | number[]> = {};
  for (const key of ['cpuModel', 'os', 'kernel', 'arch', 'virtualization']) {
    if (typeof source[key] === 'string') out[key] = (source[key] as string).slice(0, 200);
  }
  for (const key of ['cpuThreads', 'cpuCores', 'cpuSockets', 'cpuMhz', 'memTotalBytes', 'memAvailableBytes', 'swapTotalBytes', 'swapFreeBytes', 'uptimeSec']) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) out[key] = value;
  }
  if (Array.isArray(source.load)) {
    out.load = source.load.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)).slice(0, 3);
  }
  return Object.keys(out).length > 0 ? out : null;
}

// The agent reports raw command output; this keeps the useful part and
// says what it means.
function describeAgentUpdateFailure(raw?: string | null): string {
  const message = (raw ?? '').trim();
  if (/cannot fetch repository/i.test(message)) return `Le nœud n'arrive pas à télécharger le code (dépôt Git injoignable ou clé de déploiement refusée). Détail : ${message.slice(0, 300)}`;
  if (/cannot build agent/i.test(message)) return `La compilation de l'agent a échoué sur le nœud. Détail : ${message.slice(0, 300)}`;
  if (/install required packages|refresh package index/i.test(message)) return `Impossible d'installer les paquets nécessaires (apt). Détail : ${message.slice(0, 300)}`;
  if (/restart/i.test(message)) return `Le binaire est à jour mais le redémarrage du service n'a pas pu être programmé. Détail : ${message.slice(0, 300)}`;
  return message ? `La mise à jour a échoué : ${message.slice(0, 400)}` : 'La mise à jour a échoué sans message de l’agent.';
}
