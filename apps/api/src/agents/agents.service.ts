import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MountsService } from '../mounts/mounts.service';
import { PoolsService } from '../pools/pools.service';
import { SharesService } from '../shares/shares.service';
import { VlanService } from '../vlan/vlan.service';
import { CommandPayload, CommandProgressPayload, CommandResultPayload, HeartbeatPayload, StateReportPayload } from './agents.types';

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

// Node is considered offline if no heartbeat received within this time
const NODE_HEARTBEAT_TIMEOUT_MS = 60 * 1000; // 60 seconds
const LINK_OFFLINE_HANDSHAKE_SEC = 600;
const LINK_DEGRADED_HANDSHAKE_SEC = 240;

// Retry config for deadlock handling
const MAX_DEADLOCK_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 100;
const MAX_RETRY_JITTER_MS = 50;

@Injectable()
export class AgentsService implements OnModuleInit {
  private readonly logger = new Logger(AgentsService.name);
  private readonly senders = new Map<string, SendFn>();
  private readonly overlaySyncAt = new Map<string, number>();
  private readonly pendingDirectoryRequests = new Map<string, PendingDirectoryRequest>();
  private readonly pendingDirectoryScanRequests = new Map<string, PendingDirectoryScanRequest>();

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
        nodeId: params.nodeId ?? null,
        severity: 'high',
        message,
      },
    });
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly sharesService: SharesService,
    private readonly mountsService: MountsService,
    private readonly poolsService: PoolsService,
    private readonly vlanService: VlanService,
  ) {}

  onModuleInit() {
    // Initialize: mark all nodes as offline on startup, they'll come back online as they heartbeat
    this.markAllNodesOffline();
  }

  register(nodeId: string, send: SendFn) {
    this.senders.set(nodeId, send);
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

      for (const node of timedOutNodes) {
        this.logger.warn(`Node ${node.name} (${node.id}) marked offline - no heartbeat since ${node.lastSeenAt || 'startup'}`);
        await this.prisma.node.update({
          where: { id: node.id },
          data: { status: 'offline' },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Error checking node heartbeats:', error);
      await this.createSystemAlert(`Heartbeat monitor failed: ${message}`, 'high');
    }
  }

  async onHeartbeat(payload: HeartbeatPayload) {
    const { nodeId, metrics, overlay, linkMetrics, version } = payload;
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
      // Ensure default VLAN exists first
      await this.vlanService.getOrCreateVlan('default');
      // Then join the agent to it
      await this.vlanService.joinVlan(nodeId);
      this.logger.log(`✅ Node ${nodeId} created and joined VLAN`);
    } catch (error) {
      this.logger.warn(`⚠️  Failed to create VLAN or join node ${nodeId}:`, error);
    }
        
        return created;
      });

    // Ensure VLAN membership on every heartbeat (idempotent)
    try {
      const vlanMembers = await this.prisma.vlanMember.findMany({ where: { nodeId } });
      if (vlanMembers.length === 0) {
        // Ensure default VLAN exists
        await this.vlanService.getOrCreateVlan('default');
        // Then join the node if not already joined
        await this.vlanService.joinVlan(nodeId);
        this.logger.log(`✅ Node ${nodeId} joined VLAN on heartbeat`);
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

    if (linkMetrics && linkMetrics.length > 0) {
      try {
        await this.ingestOverlayLinkMetrics(nodeId, linkMetrics);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Failed to ingest link metrics for node ${nodeId}: ${message}`, error);
      }
    }

    const lastSync = this.overlaySyncAt.get(nodeId) ?? 0;
    if (Date.now() - lastSync >= 15_000) {
      await this.reconcileOverlayForNode(nodeId);
      this.overlaySyncAt.set(nodeId, Date.now());
    }
  }

  async onStateReport(payload: StateReportPayload) {
    for (const disk of payload.disks) {
      await this.prisma.disk.upsert({
        where: { nodeId_name: { nodeId: payload.nodeId, name: disk.name } },
        update: {
          mountPath: disk.mountPath,
          type: disk.type,
          health: disk.health,
          capacityGb: disk.capacityGb,
          usedGb: disk.usedGb,
        },
        create: {
          nodeId: payload.nodeId,
          name: disk.name,
          mountPath: disk.mountPath,
          type: disk.type,
          health: disk.health,
          capacityGb: disk.capacityGb,
          usedGb: disk.usedGb,
        },
      });
    }

    if (payload.smartReports.length > 0) {
      await this.prisma.smartReport.createMany({
        data: payload.smartReports.map((report) => ({
          nodeId: payload.nodeId,
          diskName: report.diskName,
          temperatureC: report.temperatureC,
          reallocatedSectors: report.reallocatedSectors,
          pendingSectors: report.pendingSectors,
          powerOnHours: report.powerOnHours,
          overall: report.overall,
        })),
      });
    }
  }

  async onCommandResult(result: CommandResultPayload) {
    this.logger.log(`Command result ${result.command} ${result.resourceId}: ${result.success}`);
    const status = result.success ? 'active' : 'error';

    if (result.resourceType === 'share') {
      await this.sharesService.setStatus(result.resourceId, status);
      return;
    }

    if (result.resourceType === 'mount') {
      await this.mountsService.setStatus(result.resourceId, status);
      return;
    }

    if (result.resourceType === 'pool_member') {
      const [poolId, nodeId] = result.resourceId.split(':');
      if (poolId && nodeId) {
        await this.poolsService.setMemberStatus(poolId, nodeId, result.success ? 'active' : 'error');
      }
      return;
    }

    if (result.resourceType === 'sync_job_run') {
      await this.prisma.syncJobRun
        .update({
          where: { id: result.resourceId },
          data: {
            status: result.success ? 'success' : 'failed',
            finishedAt: new Date(),
            bytesTransferred: result.success ? 500000000 : 0,
            log: result.message,
          },
        })
        .then(async (run) => {
          await this.prisma.syncJob.update({
            where: { id: run.syncJobId },
            data: { status: result.success ? 'success' : 'failed', lastRunAt: new Date() },
          });
        });
      return;
    }

    if (result.resourceType === 'directory_list') {
      const pending = this.pendingDirectoryRequests.get(result.resourceId);
      if (!pending) return;

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
      if (!pending) return;

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

    if (result.resourceType === 'migration') {
      if (result.command === 'stop_rsync') {
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
      return;
    }
  }

  async onCommandProgress(progress: CommandProgressPayload) {
    const normalized = Math.max(0, Math.min(100, Math.round(progress.progress)));

    if (progress.resourceType === 'sync_job_run') {
      await this.prisma.syncJobRun.update({
        where: { id: progress.resourceId },
        data: { bytesTransferred: normalized * 5_000_000 },
      });
      return;
    }

    if (progress.resourceType === 'migration') {
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
      const members = await this.prisma.vlanMember.findMany({
        where: { vlanId },
        select: { nodeId: true },
      });
      for (const member of members) {
        await this.reconcileOverlayForNode(member.nodeId);
      }
    }
  }

  private async reconcileOverlayForNode(nodeId: string) {
    try {
      const membership = await this.prisma.vlanMember.findFirst({
        where: { nodeId },
      });
      if (!membership) return;

      const members = await this.prisma.vlanMember.findMany({
        where: { vlanId: membership.vlanId },
        include: { node: true },
      });

      for (const member of members) {
        if (!member.node.vlanIp || !member.node.overlayPublicKey) {
          continue;
        }

        const peers = members
          .filter((candidate) =>
            candidate.nodeId !== member.nodeId &&
            Boolean(candidate.node.vlanIp) &&
            Boolean(candidate.node.overlayPublicKey) &&
            Boolean(candidate.node.overlayEndpoint),
          )
          .map((candidate) => ({
            nodeId: candidate.nodeId,
            publicKey: candidate.node.overlayPublicKey as string,
            endpoint: candidate.node.overlayEndpoint as string,
            allowedIps: [`${candidate.node.vlanIp}/32`],
            persistentKeepalive: 25,
          }));
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
      this.logger.warn(`Failed to reconcile overlay for node ${nodeId}:`, error);
      await this.createSystemAlert(`Overlay reconcile failed for node ${nodeId}: ${message}`, 'medium');
    }
  }

  private async ingestOverlayLinkMetrics(
    sourceNodeId: string,
    linkMetrics: NonNullable<HeartbeatPayload['linkMetrics']>,
  ) {
    const sourceMembership = await this.prisma.vlanMember.findFirst({
      where: { nodeId: sourceNodeId },
      select: { vlanId: true },
    });
    if (!sourceMembership) return;

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

      const status: 'healthy' | 'degraded' | 'offline' =
        // Only classify as offline from hard link telemetry signals.
        // Node status can be stale while tunnel traffic/probes are actually healthy.
        (handshakeOffline && !hasTraffic && !hasUsableProbe)
          ? 'offline'
          : peerReportedOffline ||
              (handshakeUnknown && !hasTraffic && !hasUsableProbe) ||
              (handshakeDegraded && !hasTraffic && !hasUsableProbe) ||
              (metric.packetLoss ?? 0) >= 8 ||
              (metric.latencyMs ?? 0) >= 180
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

      for (const update of sortedUpdates) {
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
      }
    }
  }
}
