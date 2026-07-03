import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MountsService } from '../mounts/mounts.service';
import { PoolsService } from '../pools/pools.service';
import { SharesService } from '../shares/shares.service';
import { VlanService } from '../vlan/vlan.service';
import { CommandPayload, CommandResultPayload, HeartbeatPayload, StateReportPayload } from './agents.types';

type SendFn = (event: string, payload: unknown) => void;

// Node is considered offline if no heartbeat received within this time
const NODE_HEARTBEAT_TIMEOUT_MS = 60 * 1000; // 60 seconds
const LINK_OFFLINE_HANDSHAKE_SEC = 180;
const LINK_DEGRADED_HANDSHAKE_SEC = 20;

@Injectable()
export class AgentsService implements OnModuleInit {
  private readonly logger = new Logger(AgentsService.name);
  private readonly senders = new Map<string, SendFn>();
  private readonly overlaySyncAt = new Map<string, number>();

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
      this.logger.warn('Failed to mark nodes offline on startup:', error);
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
      this.logger.error('Error checking node heartbeats:', error);
    }
  }

  async onHeartbeat(payload: HeartbeatPayload) {
    const { nodeId, metrics, overlay, linkMetrics } = payload;
    const now = new Date();

    const node = await this.prisma.node
      .update({
        where: { id: nodeId },
        data: {
          status: 'online',
          lastSeenAt: now,
          overlayPublicKey: overlay?.publicKey,
          overlayEndpoint: overlay?.endpoint,
          overlayListenPort: overlay?.listenPort,
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
      await this.ingestOverlayLinkMetrics(nodeId, linkMetrics);
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
    }
  }

  sendCommand(nodeId: string, command: CommandPayload) {
    const sender = this.senders.get(nodeId);
    if (!sender) return false;

    sender('command', command);
    return true;
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
      }
    } catch (error) {
      this.logger.warn(`Failed to reconcile overlay for node ${nodeId}:`, error);
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
              handshakeUnknown ||
              handshakeDegraded ||
              (metric.packetLoss ?? 0) >= 2 ||
              (metric.latencyMs ?? 0) >= 70
            ? 'degraded'
            : 'healthy';

      const commonData = {
        status,
        lastCheckedAt: new Date(),
      };
      const measuredLatencyMs =
        metric.latencyMs !== undefined && Number.isFinite(metric.latencyMs) ? Math.round(metric.latencyMs) : undefined;
      const measuredPacketLoss =
        metric.packetLoss !== undefined && Number.isFinite(metric.packetLoss)
          ? Number(metric.packetLoss.toFixed(1))
          : undefined;
      const measuredTxMbps = Math.max(0, Math.round(txMbps));
      const measuredRxMbps = Math.max(0, Math.round(rxMbps));

      return [
        this.prisma.vlanConnection.upsert({
          where: {
            vlanId_sourceNodeId_targetNodeId: {
              vlanId: sourceMembership.vlanId,
              sourceNodeId,
              targetNodeId: target.id,
            },
          },
          update: {
            ...commonData,
            bandwidth: measuredTxMbps,
            latencyMs: measuredLatencyMs ?? null,
            packetLoss: measuredPacketLoss ?? null,
          },
          create: {
            vlanId: sourceMembership.vlanId,
            sourceNodeId,
            targetNodeId: target.id,
            ...commonData,
            bandwidth: measuredTxMbps,
            latencyMs: measuredLatencyMs ?? null,
            packetLoss: measuredPacketLoss ?? null,
          },
        }),
        this.prisma.vlanConnection.upsert({
          where: {
            vlanId_sourceNodeId_targetNodeId: {
              vlanId: sourceMembership.vlanId,
              sourceNodeId: target.id,
              targetNodeId: sourceNodeId,
            },
          },
          update: {
            ...commonData,
            bandwidth: measuredRxMbps,
            latencyMs: measuredLatencyMs ?? null,
            packetLoss: measuredPacketLoss ?? null,
          },
          create: {
            vlanId: sourceMembership.vlanId,
            sourceNodeId: target.id,
            targetNodeId: sourceNodeId,
            ...commonData,
            bandwidth: measuredRxMbps,
            latencyMs: measuredLatencyMs ?? null,
            packetLoss: measuredPacketLoss ?? null,
          },
        }),
      ];
    });

    if (updates.length > 0) {
      await this.prisma.$transaction(updates);
    }
  }
}
