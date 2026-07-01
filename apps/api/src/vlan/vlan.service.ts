import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class VlanService implements OnModuleInit {
  private readonly logger = new Logger(VlanService.name);
  private readonly VLAN_SUBNET = '10.255.0.0/16';
  private readonly VLAN_GATEWAY = '10.255.0.1';
  private readonly BASE_IP = 0xacff0002; // 10.255.0.2 in hex

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    // No initialization needed - VLAN is created on first agent heartbeat
    this.logger.log('VlanService ready. VLAN will be created when first agent connects.');
  }

  async getOrCreateVlan(name: string = 'default'): Promise<any> {
    try {
      let vlan = await this.prisma.vlan.findUnique({
        where: { name },
        include: { members: true, connections: true },
      });

      if (!vlan) {
        vlan = await this.prisma.vlan.create({
          data: {
            name,
            subnetCidr: this.VLAN_SUBNET,
            description: `Automated VLAN for cluster ${name}`,
          },
          include: { members: true, connections: true },
        });
      }

      return vlan;
    } catch (error) {
      this.logger.error('Database error in getOrCreateVlan:', error instanceof Error ? error.message : error);
      throw error; // Let controller handle the error gracefully
    }
  }

  async joinVlan(nodeId: string, vlanName: string = 'default'): Promise<any> {
    const vlan = await this.getOrCreateVlan(vlanName);
    
    const existingMember = await this.prisma.vlanMember.findFirst({
      where: { nodeId, vlanId: vlan.id },
    });

    if (existingMember) {
      return existingMember;
    }

    const nextIpIndex = await this.prisma.vlanMember.count({
      where: { vlanId: vlan.id },
    });

    const vlanIp = this.generateVlanIp(nextIpIndex + 2);
    const vlanMac = this.generateVlanMac(nodeId);

    const member = await this.prisma.vlanMember.create({
      data: {
        vlanId: vlan.id,
        nodeId,
        vlanIp,
        vlanMac,
      },
    });

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

  async getVlanMembers(vlanId: string): Promise<any> {
    return this.prisma.vlanMember.findMany({
      where: { vlanId },
      include: { node: true },
    });
  }

  async getVlanConnections(vlanId: string): Promise<any> {
    return this.prisma.vlanConnection.findMany({
      where: { vlanId },
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
    vlanId: string,
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
    return this.prisma.vlanConnectionTest.create({
      data: {
        vlanId,
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

  async getRecentConnectionTests(vlanId: string, limit: number = 50): Promise<any> {
    return this.prisma.vlanConnectionTest.findMany({
      where: { vlanId },
      include: {
        initiatorNode: { select: { id: true, name: true, vlanIp: true } },
      },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
  }

  async getVlanStatus(vlanId: string): Promise<any> {
    const [vlan, members, connections, failedTests] = await Promise.all([
      this.prisma.vlan.findUnique({ where: { id: vlanId } }),
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
}
