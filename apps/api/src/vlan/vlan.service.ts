import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const CONNECTION_OFFLINE_TIMEOUT_MS = 60_000;
const CONNECTION_DEGRADED_TIMEOUT_MS = 20_000;
const CONNECTION_METRICS_WINDOW_MS = 120_000;
const DEFAULT_LINK_CAPACITY_BPS = 125_000_000; // ~1 Gbps

@Injectable()
export class VlanService implements OnModuleInit {
  private readonly logger = new Logger(VlanService.name);
  private readonly VLAN_SUBNET = '10.255.0.0/16';
  private readonly VLAN_GATEWAY = '10.255.0.1';
  private readonly BASE_IP = 0x0aff0002; // 10.255.0.2 in hex

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    // No initialization needed - VLAN is created on first agent heartbeat
    this.logger.log('VlanService ready. VLAN will be created when first agent connects.');
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async refreshAllVlanConnections() {
    const vlans = await this.prisma.vlan.findMany({
      select: { id: true },
    });

    await Promise.all(
      vlans.map(async (vlan) => {
        try {
          await this.refreshVlanConnections(vlan.id);
        } catch (error) {
          this.logger.warn(
            `Failed to refresh telemetry for VLAN ${vlan.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }),
    );
  }

  async getOrCreateVlan(name: string = 'default'): Promise<any> {
    try {
      let vlan = await this.prisma.vlan.findUnique({
        where: { name },
        include: { members: true, connections: true },
      });

      if (!vlan) {
        try {
          vlan = await this.prisma.vlan.create({
            data: {
              name,
              subnetCidr: this.VLAN_SUBNET,
              description: `Automated VLAN for cluster ${name}`,
            },
            include: { members: true, connections: true },
          });
        } catch (error) {
          if (this.isUniqueConstraintError(error)) {
            vlan = await this.prisma.vlan.findUnique({
              where: { name },
              include: { members: true, connections: true },
            });
            if (vlan) return vlan;
          }
          throw error;
        }
      }

      return vlan;
    } catch (error) {
      this.logger.error('Database error in getOrCreateVlan:', error instanceof Error ? error.message : error);
      throw error; // Let controller handle the error gracefully
    }
  }

  async joinVlan(nodeId: string, vlanName: string = 'default'): Promise<any> {
    const vlan = await this.getOrCreateVlan(vlanName);
    this.logger.error(`joinVlan START: vlan=${vlan.id} name=${vlan.name} nodeId=${nodeId}`);
    
    const existingMember = await this.prisma.vlanMember.findFirst({
      where: { nodeId, vlanId: vlan.id },
    });

    if (existingMember) {
      this.logger.error(`joinVlan: member already exists ${existingMember.id}`);
      return existingMember;
    }

    // Check if Node already has a stored VLAN IP from previous join
    const node = await this.prisma.node.findUnique({ where: { id: nodeId } });
    const vlanIp = node?.vlanIp || this.generateDeterministicVlanIp(nodeId);
    const vlanMac = node?.vlanMac || this.generateVlanMac(nodeId);
    this.logger.error(`joinVlan: creating member vlanId=${vlan.id} vlanIp=${vlanIp} vlanMac=${vlanMac}`);

    let member;
    try {
      member = await this.prisma.vlanMember.create({
        data: {
          vlanId: vlan.id,
          nodeId,
          vlanIp,
          vlanMac,
        },
      });
      this.logger.error(`joinVlan: member CREATED ${member.id}`);
    } catch (error) {
      this.logger.error(`joinVlan: create ERROR ${error instanceof Error ? error.message : error}`);
      if (this.isUniqueConstraintError(error)) {
        const existing = await this.prisma.vlanMember.findFirst({
          where: { nodeId, vlanId: vlan.id },
        });
        if (existing) {
          this.logger.error(`joinVlan: recovered existing member ${existing.id}`);
          return existing;
        }
      }
      throw error;
    }

    await this.prisma.node.update({
      where: { id: nodeId },
      data: { vlanIp, vlanMac },
    });

    // Create connections to all existing members
    const existingMembers = await this.prisma.vlanMember.findMany({
      where: { vlanId: vlan.id, nodeId: { not: nodeId } },
    });

    for (const existing of existingMembers) {
      await Promise.all([
        this.prisma.vlanConnection.upsert({
          where: {
            vlanId_sourceNodeId_targetNodeId: {
              vlanId: vlan.id,
              sourceNodeId: nodeId,
              targetNodeId: existing.nodeId,
            },
          },
          update: { status: 'healthy' },
          create: {
            vlanId: vlan.id,
            sourceNodeId: nodeId,
            targetNodeId: existing.nodeId,
            status: 'unknown',
          },
        }),
        this.prisma.vlanConnection.upsert({
          where: {
            vlanId_sourceNodeId_targetNodeId: {
              vlanId: vlan.id,
              sourceNodeId: existing.nodeId,
              targetNodeId: nodeId,
            },
          },
          update: { status: 'healthy' },
          create: {
            vlanId: vlan.id,
            sourceNodeId: existing.nodeId,
            targetNodeId: nodeId,
            status: 'unknown',
          },
        }),
      ]);
    }

    return member;
  }

  async getVlanMembers(vlanIdOrName: string): Promise<any> {
    const vlan = await this.prisma.vlan.findFirst({
      where: {
        OR: [
          { id: vlanIdOrName },
          { name: vlanIdOrName }
        ]
      }
    });

    if (!vlan) {
      throw new Error(`VLAN not found: ${vlanIdOrName}`);
    }

    return this.prisma.vlanMember.findMany({
      where: { vlanId: vlan.id },
      include: { node: true },
    });
  }

  async getVlanConnections(vlanIdOrName: string): Promise<any> {
    const vlan = await this.prisma.vlan.findFirst({
      where: {
        OR: [
          { id: vlanIdOrName },
          { name: vlanIdOrName }
        ]
      }
    });

    if (!vlan) {
      throw new Error(`VLAN not found: ${vlanIdOrName}`);
    }

    await this.refreshVlanConnections(vlan.id);

    return this.prisma.vlanConnection.findMany({
      where: { vlanId: vlan.id },
      include: {
        sourceNode: { select: { id: true, name: true, vlanIp: true } },
        targetNode: { select: { id: true, name: true, vlanIp: true } },
      },
      orderBy: [{ sourceNodeId: 'asc' }, { targetNodeId: 'asc' }],
    });
  }

  async updateConnectionStatus(
    vlanId: string,
    sourceNodeId: string,
    targetNodeId: string,
    status: 'healthy' | 'degraded' | 'offline',
    metrics?: { latencyMs?: number; packetLoss?: number; bandwidth?: number },
  ): Promise<any> {
    return this.prisma.vlanConnection.update({
      where: {
        vlanId_sourceNodeId_targetNodeId: {
          vlanId,
          sourceNodeId,
          targetNodeId,
        },
      },
      data: {
        status,
        lastCheckedAt: new Date(),
        ...metrics,
      },
    });
  }

  async recordConnectionTest(
    vlanIdOrName: string,
    initiatorNodeId: string,
    targetNodeId: string,
    testType: 'ping' | 'connectivity' | 'latency',
    result: {
      status: 'success' | 'failed' | 'timeout';
      latencyMs?: number;
      packetLoss?: number;
      message?: string;
    },
  ): Promise<any> {
    // Resolve VLAN name alias to ID
    const vlanLookup = await this.prisma.vlan.findFirst({
      where: {
        OR: [
          { id: vlanIdOrName },
          { name: vlanIdOrName }
        ]
      }
    });

    if (!vlanLookup) {
      throw new Error(`VLAN not found: ${vlanIdOrName}`);
    }

    return this.prisma.vlanConnectionTest.create({
      data: {
        vlanId: vlanLookup.id,
        initiatorNodeId,
        targetNodeId,
        testType,
        status: result.status,
        resultCode: result.status === 'success' ? 0 : 1,
        resultMessage: result.message,
        latencyMs: result.latencyMs,
        packetLoss: result.packetLoss,
        completedAt: new Date(),
      },
    });
  }

  async getRecentConnectionTests(vlanIdOrName: string, limit: number = 50): Promise<any> {
    // Resolve VLAN name alias to ID
    const vlanLookup = await this.prisma.vlan.findFirst({
      where: {
        OR: [
          { id: vlanIdOrName },
          { name: vlanIdOrName }
        ]
      }
    });

    if (!vlanLookup) {
      throw new Error(`VLAN not found: ${vlanIdOrName}`);
    }

    return this.prisma.vlanConnectionTest.findMany({
      where: { vlanId: vlanLookup.id },
      include: {
        initiatorNode: { select: { id: true, name: true, vlanIp: true } },
      },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
  }

  async getVlanStatus(vlanIdOrName: string): Promise<any> {
    // Resolve VLAN name alias to ID
    const vlanLookup = await this.prisma.vlan.findFirst({
      where: {
        OR: [
          { id: vlanIdOrName },
          { name: vlanIdOrName }
        ]
      }
    });

    if (!vlanLookup) {
      throw new Error(`VLAN not found: ${vlanIdOrName}`);
    }

    const vlanId = vlanLookup.id;
    await this.refreshVlanConnections(vlanId);

    const [vlan, members, connections, failedTests] = await Promise.all([
      this.prisma.vlan.findUnique({
        where: { id: vlanId },
        include: { members: { include: { node: true } } }
      }),
      this.prisma.vlanMember.count({ where: { vlanId } }),
      this.prisma.vlanConnection.findMany({
        where: { vlanId },
        select: { status: true },
      }),
      this.prisma.vlanConnectionTest.findMany({
        where: { vlanId, status: 'failed' },
        take: 10,
      }),
    ]);

    const healthyConnections = connections.filter((c) => c.status === 'healthy').length;
    const degradedConnections = connections.filter((c) => c.status === 'degraded').length;
    const offlineConnections = connections.filter((c) => c.status === 'offline').length;

    return {
      vlan,
      memberCount: members,
      connectionStats: {
        total: connections.length,
        healthy: healthyConnections,
        degraded: degradedConnections,
        offline: offlineConnections,
      },
      recentFailures: failedTests,
    };
  }

  private generateVlanIp(index: number): string {
    const ipNum = this.BASE_IP + index;
    return [
      (ipNum >>> 24) & 0xff,
      (ipNum >>> 16) & 0xff,
      (ipNum >>> 8) & 0xff,
      ipNum & 0xff,
    ].join('.');
  }

  private generateDeterministicVlanIp(nodeId: string): string {
    // Hash nodeId to get deterministic offset (ensures same IP on restart)
    let hash = 0;
    for (let i = 0; i < nodeId.length; i++) {
      hash = ((hash << 5) - hash) + nodeId.charCodeAt(i);
      hash |= 0;
    }
    // Map hash to index 1-253 (skip 0=gateway, 254=broadcast)
    const index = (Math.abs(hash) % 253) + 1;
    return this.generateVlanIp(index);
  }

  private generateVlanMac(nodeId: string): string {
    // Generate a deterministic MAC address from node ID
    let hash = 0;
    for (let i = 0; i < nodeId.length; i++) {
      hash = ((hash << 5) - hash) + nodeId.charCodeAt(i);
      hash |= 0;
    }
    
    const bytes = [
      0x02,
      (Math.abs(hash) >> 24) & 0xff,
      (Math.abs(hash) >> 16) & 0xff,
      (Math.abs(hash) >> 8) & 0xff,
      Math.abs(hash) & 0xff,
      (Math.abs(hash) >> 4) & 0xff,
    ];

    return bytes.map((b) => b.toString(16).padStart(2, '0')).join(':');
  }

  async heartbeat(nodeId: string, vlanId?: string): Promise<any> {
    const membership = await this.prisma.vlanMember.findFirst({
      where: vlanId ? { nodeId, vlanId } : { nodeId },
    });

    if (!membership) {
      return null;
    }

    return this.prisma.vlanMember.update({
      where: { id: membership.id },
      data: { lastHeartbeat: new Date() },
    });
  }

  private isUniqueConstraintError(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private async refreshVlanConnections(vlanId: string) {
    const [members, connections] = await Promise.all([
      this.prisma.vlanMember.findMany({
        where: { vlanId },
        select: {
          nodeId: true,
          node: {
            select: {
              id: true,
              status: true,
              lastSeenAt: true,
            },
          },
        },
      }),
      this.prisma.vlanConnection.findMany({
        where: { vlanId },
        select: {
          id: true,
          sourceNodeId: true,
          targetNodeId: true,
          status: true,
          latencyMs: true,
          packetLoss: true,
          bandwidth: true,
          lastCheckedAt: true,
        },
      }),
    ]);

    if (connections.length === 0 || members.length === 0) {
      return;
    }

    const nodeIds = members.map((member) => member.nodeId);
    const samples = await this.prisma.metricSample.findMany({
      where: {
        nodeId: { in: nodeIds },
        createdAt: { gte: new Date(Date.now() - CONNECTION_METRICS_WINDOW_MS) },
      },
      select: {
        nodeId: true,
        networkRx: true,
        networkTx: true,
        createdAt: true,
      },
      orderBy: [{ nodeId: 'asc' }, { createdAt: 'desc' }],
    });

    const memberByNodeId = new Map(members.map((member) => [member.nodeId, member]));
    const sampleByNodeId = new Map<string, { networkRx: number; networkTx: number }>();
    for (const sample of samples) {
      if (!sampleByNodeId.has(sample.nodeId)) {
        sampleByNodeId.set(sample.nodeId, {
          networkRx: sample.networkRx,
          networkTx: sample.networkTx,
        });
      }
    }

    const now = new Date();
    const onlineMembers = members.filter((member) => this.isNodeReachable(member.node, now)).length;
    const updates = connections.flatMap((connection) => {
      const checkedRecently =
        connection.lastCheckedAt &&
        now.getTime() - connection.lastCheckedAt.getTime() <= 15_000 &&
        connection.status !== 'unknown';
      const hasMeasuredMetrics =
        connection.latencyMs !== null || connection.packetLoss !== null || connection.bandwidth !== null;
      if (checkedRecently && hasMeasuredMetrics) {
        return [];
      }

      const source = memberByNodeId.get(connection.sourceNodeId);
      const target = memberByNodeId.get(connection.targetNodeId);
      const telemetry = this.deriveConnectionTelemetry({
        source,
        target,
        sampleByNodeId,
        onlineMembers,
        now,
      });

      return [
        this.prisma.vlanConnection.update({
          where: { id: connection.id },
          data: {
            status: telemetry.status,
            latencyMs: telemetry.latencyMs,
            packetLoss: telemetry.packetLoss,
            bandwidth: telemetry.bandwidth,
            lastCheckedAt: now,
          },
        }),
      ];
    });

    if (updates.length > 0) {
      await this.prisma.$transaction(updates);
    }
  }

  private isNodeReachable(
    node: { id: string; status: string; lastSeenAt: Date | null } | null | undefined,
    now: Date,
  ) {
    if (!node || node.status !== 'online' || !node.lastSeenAt) {
      return false;
    }
    return now.getTime() - node.lastSeenAt.getTime() <= CONNECTION_OFFLINE_TIMEOUT_MS;
  }

  private deriveConnectionTelemetry(args: {
    source:
      | {
          nodeId: string;
          node: {
            id: string;
            status: string;
            lastSeenAt: Date | null;
          };
        }
      | undefined;
    target:
      | {
          nodeId: string;
          node: {
            id: string;
            status: string;
            lastSeenAt: Date | null;
          };
        }
      | undefined;
    sampleByNodeId: Map<string, { networkRx: number; networkTx: number }>;
    onlineMembers: number;
    now: Date;
  }): {
    status: 'healthy' | 'degraded' | 'offline';
    latencyMs: number | null;
    packetLoss: number | null;
    bandwidth: number | null;
  } {
    const { source, target, sampleByNodeId, onlineMembers, now } = args;
    if (!source || !target) {
      return { status: 'offline', latencyMs: null, packetLoss: null, bandwidth: null };
    }

    const sourceReachable = this.isNodeReachable(source.node, now);
    const targetReachable = this.isNodeReachable(target.node, now);
    if (!sourceReachable || !targetReachable) {
      return { status: 'offline', latencyMs: null, packetLoss: null, bandwidth: null };
    }

    const sourceSample = sampleByNodeId.get(source.nodeId);
    const targetSample = sampleByNodeId.get(target.nodeId);
    const peersPerNode = Math.max(1, onlineMembers - 1);

    const sourceTxPerLinkBps = Math.max(0, (sourceSample?.networkTx ?? 0) / peersPerNode);
    const targetRxPerLinkBps = Math.max(0, (targetSample?.networkRx ?? 0) / peersPerNode);
    const linkBps = Math.max(0, Math.min(sourceTxPerLinkBps, targetRxPerLinkBps));
    const bandwidthMbps = Math.round((linkBps * 8) / 1_000_000);

    const sourceLagMs = source.node.lastSeenAt ? now.getTime() - source.node.lastSeenAt.getTime() : CONNECTION_OFFLINE_TIMEOUT_MS;
    const targetLagMs = target.node.lastSeenAt ? now.getTime() - target.node.lastSeenAt.getTime() : CONNECTION_OFFLINE_TIMEOUT_MS;
    const heartbeatLagMs = Math.max(sourceLagMs, targetLagMs);
    const congestionRatio = Math.min(1, linkBps / DEFAULT_LINK_CAPACITY_BPS);

    const latencyMs = Math.max(1, Math.round(3 + heartbeatLagMs / 1_000 + congestionRatio * 25));
    const staleLoss = heartbeatLagMs > 15_000 ? (heartbeatLagMs - 15_000) / 2_000 : 0;
    const packetLoss = Number(Math.min(100, Math.max(0, staleLoss + congestionRatio * 3)).toFixed(1));

    const status =
      heartbeatLagMs >= CONNECTION_DEGRADED_TIMEOUT_MS || packetLoss >= 2 || latencyMs >= 70
        ? 'degraded'
        : 'healthy';

    return {
      status,
      latencyMs,
      packetLoss,
      bandwidth: bandwidthMbps,
    };
  }
}
