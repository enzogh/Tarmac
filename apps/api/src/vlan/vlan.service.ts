import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Region, resolveRegion } from './region';

const CONNECTION_OFFLINE_TIMEOUT_MS = 60_000;
const CONNECTION_DEGRADED_TIMEOUT_MS = 20_000;
const CONNECTION_ALERT_COOLDOWN_MS = 10 * 60_000;
const CONNECTION_STATUS_RANK: Record<string, number> = { healthy: 0, unknown: 0, degraded: 1, offline: 2 };
const CONNECTION_SAMPLE_RETENTION_DAYS = 30;
const HISTORY_RANGE_MS: Record<string, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

@Injectable()
export class VlanService implements OnModuleInit {
  private readonly logger = new Logger(VlanService.name);
  private readonly VLAN_SUBNET = '10.255.0.0/16';
  private readonly VLAN_GATEWAY = '10.255.0.1';
  private readonly BASE_IP = 0x0aff0002; // 10.255.0.2 in hex
  private readonly connectionAlertCooldownAt = new Map<string, number>();

  constructor(private prisma: PrismaService) {}

  getVlanSubnet() {
    return this.VLAN_SUBNET;
  }

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

    const members = await this.prisma.vlanMember.findMany({
      where: { vlanId: vlan.id },
      include: { node: true },
    });
    return members.map((member) => this.withRegion(member));
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

  /**
   * Single write path for both VlanConnection update sites (real link-metric
   * ingestion and the heartbeat-timeout refresh loop): records a history
   * sample unconditionally, and raises a panel alert only on a genuine
   * degrading transition (never on recovery — matches the failure-only
   * convention used by the other alert producers in this codebase).
   */
  async recordConnectionTransition(
    vlanId: string,
    sourceNodeId: string,
    targetNodeId: string,
    previousStatus: string | undefined,
    next: {
      status: 'healthy' | 'degraded' | 'offline' | 'unknown';
      latencyMs?: number | null;
      packetLoss?: number | null;
      bandwidth?: number | null;
    },
  ): Promise<void> {
    await this.prisma.vlanConnectionSample.create({
      data: {
        vlanId,
        sourceNodeId,
        targetNodeId,
        status: next.status,
        latencyMs: next.latencyMs ?? null,
        packetLoss: next.packetLoss ?? null,
        bandwidth: next.bandwidth ?? null,
      },
    });

    if (!previousStatus || previousStatus === next.status) return;
    const isDegrading = (CONNECTION_STATUS_RANK[next.status] ?? 0) > (CONNECTION_STATUS_RANK[previousStatus] ?? 0);
    if (!isDegrading) return;

    const pairKey = [sourceNodeId, targetNodeId].sort().join('__');
    const cooldownKey = `${pairKey}:${next.status}`;
    const lastAlertAt = this.connectionAlertCooldownAt.get(cooldownKey) ?? 0;
    if (Date.now() - lastAlertAt < CONNECTION_ALERT_COOLDOWN_MS) return;
    this.connectionAlertCooldownAt.set(cooldownKey, Date.now());

    const [source, target] = await Promise.all([
      this.prisma.node.findUnique({ where: { id: sourceNodeId }, select: { name: true, vlanIp: true, mutedUntil: true } }),
      this.prisma.node.findUnique({ where: { id: targetNodeId }, select: { name: true, vlanIp: true, mutedUntil: true } }),
    ]);

    const now = Date.now();
    if ((source?.mutedUntil && source.mutedUntil.getTime() > now) || (target?.mutedUntil && target.mutedUntil.getTime() > now)) {
      return;
    }

    const sourceLabel = `${source?.name ?? sourceNodeId} (${source?.vlanIp ?? '?'})`;
    const targetLabel = `${target?.name ?? targetNodeId} (${target?.vlanIp ?? '?'})`;
    const statusLabel = next.status === 'offline' ? 'hors ligne' : 'dégradé';

    await this.prisma.alert.create({
      data: {
        nodeId: sourceNodeId,
        severity: next.status === 'offline' ? 'high' : 'medium',
        message: `Lien VLAN ${statusLabel} : ${sourceLabel} ↔ ${targetLabel}`,
      },
    });
  }

  async recordConnectionTest(
    vlanIdOrName: string,
    initiatorNodeId: string,
    targetNodeId: string,
    testType: 'ping' | 'traceroute',
    result: {
      status: 'success' | 'failed' | 'timeout';
      latencyMs?: number;
      packetLoss?: number;
      message?: string;
      hops?: Array<{ hop: number; ip: string | null; latencyMs: number | null }>;
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
        hops: result.hops,
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

  async getConnectionHistory(
    vlanIdOrName: string,
    sourceNodeId: string,
    targetNodeId: string,
    range: string = '1h',
  ): Promise<{ samples: any[]; uptimePercent: number }> {
    const vlanLookup = await this.prisma.vlan.findFirst({
      where: {
        OR: [{ id: vlanIdOrName }, { name: vlanIdOrName }],
      },
    });

    if (!vlanLookup) {
      throw new Error(`VLAN not found: ${vlanIdOrName}`);
    }

    const ms = HISTORY_RANGE_MS[range] ?? HISTORY_RANGE_MS['1h'];
    const samples = await this.prisma.vlanConnectionSample.findMany({
      where: {
        vlanId: vlanLookup.id,
        sourceNodeId,
        targetNodeId,
        createdAt: { gte: new Date(Date.now() - ms) },
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });

    const uptimePercent =
      samples.length > 0
        ? Math.round((samples.filter((sample) => sample.status === 'healthy').length / samples.length) * 100)
        : 100;

    return { samples, uptimePercent };
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async pruneOldConnectionSamples() {
    const cutoff = new Date(Date.now() - CONNECTION_SAMPLE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.vlanConnectionSample.deleteMany({ where: { createdAt: { lt: cutoff } } });
    if (count > 0) {
      this.logger.log(`Pruned ${count} VLAN connection sample(s) older than ${CONNECTION_SAMPLE_RETENTION_DAYS} days`);
    }
  }

  /**
   * Designates (or clears) a node as the regional gateway used by cross-region
   * segmentation in AgentsService.reconcileOverlayForVlan. Only one gateway is
   * allowed per region within a VLAN — enabling one clears any other. Actual
   * WireGuard reconfiguration is triggered by the caller (AgentsService), not
   * here, to avoid a hard dependency from VlanService onto AgentsService.
   */
  async setGateway(
    vlanIdOrName: string,
    nodeId: string,
    enabled: boolean,
  ): Promise<{ nodeId: string; overlayIsGateway: boolean; region: Region | null }> {
    const vlan = await this.prisma.vlan.findFirst({
      where: { OR: [{ id: vlanIdOrName }, { name: vlanIdOrName }] },
    });
    if (!vlan) {
      throw new Error(`VLAN not found: ${vlanIdOrName}`);
    }

    const membership = await this.prisma.vlanMember.findFirst({
      where: { vlanId: vlan.id, nodeId },
      include: { node: true },
    });
    if (!membership) {
      throw new Error(`Node is not a member of this VLAN: ${nodeId}`);
    }

    const region = resolveRegion(membership.node.locationCountryCode);
    if (enabled && !region) {
      throw new Error(
        "Impossible de désigner ce nœud comme passerelle : sa région ne peut pas être déterminée (localisation manquante)",
      );
    }

    if (enabled && region) {
      const otherMembers = await this.prisma.vlanMember.findMany({
        where: { vlanId: vlan.id, nodeId: { not: nodeId } },
        include: { node: true },
      });
      const idsToClear = otherMembers
        .filter((m) => m.node.overlayIsGateway && resolveRegion(m.node.locationCountryCode) === region)
        .map((m) => m.nodeId);
      if (idsToClear.length > 0) {
        await this.prisma.node.updateMany({ where: { id: { in: idsToClear } }, data: { overlayIsGateway: false } });
      }
    }

    await this.prisma.node.update({ where: { id: nodeId }, data: { overlayIsGateway: enabled } });

    return { nodeId, overlayIsGateway: enabled, region };
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

    const vlanWithRegions = vlan
      ? { ...vlan, members: (vlan.members ?? []).map((member: any) => this.withRegion(member)) }
      : vlan;

    return {
      vlan: vlanWithRegions,
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

  private withRegion<T extends { node?: { locationCountryCode?: string | null } | null }>(
    member: T,
  ): T & { region: Region | null } {
    return { ...member, region: resolveRegion(member.node?.locationCountryCode) };
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

    const memberByNodeId = new Map(members.map((member) => [member.nodeId, member]));

    const now = new Date();
    const transitions: Array<{
      sourceNodeId: string;
      targetNodeId: string;
      previousStatus: string;
      next: { status: 'healthy' | 'degraded' | 'offline'; latencyMs: null; packetLoss: null; bandwidth: null };
    }> = [];
    const updates = connections.flatMap((connection) => {
      const checkedRecently =
        connection.lastCheckedAt &&
        now.getTime() - connection.lastCheckedAt.getTime() <= 15_000 &&
        connection.status !== 'unknown';
      const looksLikeSyntheticFailure =
        connection.packetLoss === 100 &&
        connection.latencyMs === null &&
        (connection.bandwidth === null || connection.bandwidth === 0);
      const hasMeasuredMetrics =
        !looksLikeSyntheticFailure &&
        (connection.latencyMs !== null || connection.packetLoss !== null || connection.bandwidth !== null);
      if (checkedRecently && hasMeasuredMetrics) {
        return [];
      }

      const source = memberByNodeId.get(connection.sourceNodeId);
      const target = memberByNodeId.get(connection.targetNodeId);
      const telemetry = this.deriveConnectionTelemetry({
        source,
        target,
        now,
      });

      transitions.push({
        sourceNodeId: connection.sourceNodeId,
        targetNodeId: connection.targetNodeId,
        previousStatus: connection.status,
        next: { status: telemetry.status, latencyMs: null, packetLoss: null, bandwidth: null },
      });

      return [
        this.prisma.vlanConnection.update({
          where: { id: connection.id },
          data: {
            status: telemetry.status,
            // This refresh path has no direct probe result; clear stale quality metrics.
            // Real measured values are written by agent link-metric ingestion.
            latencyMs: null,
            packetLoss: null,
            bandwidth: null,
            lastCheckedAt: now,
          },
        }),
      ];
    });

    if (updates.length > 0) {
      await this.prisma.$transaction(updates);
    }

    for (const transition of transitions) {
      await this.recordConnectionTransition(
        vlanId,
        transition.sourceNodeId,
        transition.targetNodeId,
        transition.previousStatus,
        transition.next,
      );
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
    now: Date;
  }): {
    status: 'healthy' | 'degraded' | 'offline';
    latencyMs: number | null;
    packetLoss: number | null;
    bandwidth: number | null;
  } {
    const { source, target, now } = args;
    if (!source || !target) {
      return { status: 'offline', latencyMs: null, packetLoss: null, bandwidth: null };
    }

    const sourceReachable = this.isNodeReachable(source.node, now);
    const targetReachable = this.isNodeReachable(target.node, now);
    if (!sourceReachable || !targetReachable) {
      return { status: 'offline', latencyMs: null, packetLoss: null, bandwidth: null };
    }

    const sourceLagMs = source.node.lastSeenAt ? now.getTime() - source.node.lastSeenAt.getTime() : CONNECTION_OFFLINE_TIMEOUT_MS;
    const targetLagMs = target.node.lastSeenAt ? now.getTime() - target.node.lastSeenAt.getTime() : CONNECTION_OFFLINE_TIMEOUT_MS;
    const heartbeatLagMs = Math.max(sourceLagMs, targetLagMs);

    const status = heartbeatLagMs >= CONNECTION_DEGRADED_TIMEOUT_MS ? 'degraded' : 'healthy';

    return {
      status,
      // Keep link metrics truthful: only the agent should provide measured values.
      latencyMs: null,
      packetLoss: null,
      bandwidth: null,
    };
  }
}
