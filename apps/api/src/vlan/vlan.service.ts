import { Injectable, NotFoundException, OnModuleInit, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_WORKSPACE_ID } from '../workspaces/default-workspace';
import { chainSegments, LinkHistoryPoint, relayGateways, uptimePercent } from './link-history';
import { activeGateways } from './overlay-topology';
import { Region, resolveRegion } from './region';

// The Default workspace permanently keeps this exact range - it's what every
// already-deployed node's vlanIp/vlanMac was derived from before workspaces
// existed, and re-deriving it from a parsed CIDR (see parseBaseIp) must
// reproduce it byte-for-byte. Never change this constant.
const DEFAULT_SUBNET_CIDR = '10.255.0.0/16';
// New (non-Default) workspaces are carved out of a disjoint /12 block so they
// can never collide with the Default range above: 10.16.0.0/16 (index 1)
// through 10.31.0.0/16 (index 16), assigned via Workspace.subnetIndex.
const WORKSPACE_SUBNET_BASE_OCTET = 16;

function cidrForSubnetIndex(subnetIndex: number): string {
  const secondOctet = WORKSPACE_SUBNET_BASE_OCTET + subnetIndex - 1;
  if (secondOctet < WORKSPACE_SUBNET_BASE_OCTET || secondOctet > 31) {
    throw new Error(`subnetIndex ${subnetIndex} is out of the allocatable range (max 16 workspaces)`);
  }
  return `10.${secondOctet}.0.0/16`;
}

// Inverse of the ip-string math below: parse a "10.x.0.0/16" CIDR's network
// address into the same 32-bit int shape as the old hardcoded BASE_IP
// constant (+2 to skip the .0 network address and .1 gateway, exactly as
// BASE_IP = 0x0aff0002 already did for 10.255.0.0/16).
function parseBaseIp(cidr: string): number {
  const [address] = cidr.split('/');
  const octets = address.split('.').map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
    throw new Error(`Invalid subnet CIDR: ${cidr}`);
  }
  const networkAddress = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  return networkAddress + 2;
}

type SubnetWorkspace = { isDefault: boolean; subnetIndex: number | null };

function resolveSubnetCidr(workspace: SubnetWorkspace): string {
  if (workspace.isDefault) return DEFAULT_SUBNET_CIDR;
  if (workspace.subnetIndex == null) {
    throw new Error('Non-default workspace is missing a subnetIndex - cannot provision its VLAN');
  }
  return cidrForSubnetIndex(workspace.subnetIndex);
}

const CONNECTION_OFFLINE_TIMEOUT_MS = 60_000;
const CONNECTION_DEGRADED_TIMEOUT_MS = 20_000;
const CONNECTION_ALERT_COOLDOWN_MS = 10 * 60_000;
// A link has to stay offline this long before it raises an alert: an agent
// reconnecting (restart, update, brief network blip) comes back well within it.
const CONNECTION_OFFLINE_ALERT_DELAY_MS = 90_000;
// AgentsService marks every node offline when the API boots, and agents only
// flip back online on their first heartbeat after reconnecting (with backoff).
// Without this, every deploy alerted on each link of the slowest agents.
const CONNECTION_ALERT_STARTUP_GRACE_MS = 3 * 60_000;
// Heartbeats/refreshes land every 5s per pair, but the history endpoint only needs a
// steady-ish cadence to compute uptime% and draw a trend line — sampling every heartbeat
// makes VlanConnectionSample grow O(pairs × 1/5s), which is O(N²) in fleet size. Every real
// status transition is still recorded immediately regardless of this throttle.
const CONNECTION_SAMPLE_THROTTLE_MS = 30_000;
const HOUR_MS = 60 * 60 * 1000;
// Raw samples are O(pairs) every 30 s: kept 48 h for the detailed views, the
// longer history lives on as hourly VlanConnectionRollup rows.
const RAW_SAMPLE_RETENTION_MS = 48 * HOUR_MS;
const CONNECTION_ROLLUP_RETENTION_DAYS = 30;
// bucketMs 0 = raw samples. Longer ranges are averaged per bucket instead of
// truncated, so the chart always spans the whole range.
const HISTORY_RESOLUTION: Record<string, { rangeMs: number; bucketMs: number }> = {
  '1h': { rangeMs: HOUR_MS, bucketMs: 0 },
  '24h': { rangeMs: 24 * HOUR_MS, bucketMs: 5 * 60 * 1000 },
  '7d': { rangeMs: 7 * 24 * HOUR_MS, bucketMs: HOUR_MS },
};
const SEVERITY_STATUS = ['healthy', 'unknown', 'degraded', 'offline'];
const SEVERITY_SQL = Prisma.sql`CASE "status" WHEN 'healthy' THEN 1 WHEN 'unknown' THEN 2 WHEN 'degraded' THEN 3 ELSE 4 END`;

export type GatewayRole = 'primary' | 'backup';

type BucketRow = {
  createdAt: Date;
  total: number;
  healthy: number;
  severity: number;
  latencyMs: number | null;
  packetLoss: number | null;
  bandwidth: number | null;
};

const floorTo = (ms: number, step: number) => Math.floor(ms / step) * step;
const floorToDate = (date: Date, step: number) => new Date(floorTo(date.getTime(), step));

@Injectable()
export class VlanService implements OnModuleInit {
  private readonly logger = new Logger(VlanService.name);
  private readonly connectionAlertCooldownAt = new Map<string, number>();
  private readonly connectionSampleWrittenAt = new Map<string, number>();
  // Links currently offline but not yet alerted on, keyed source:target.
  private readonly pendingOfflineAlerts = new Map<string, { vlanId: string; sourceNodeId: string; targetNodeId: string; since: number }>();
  private readonly bootedAt = Date.now();

  constructor(private prisma: PrismaService) {}

  // Used to compute an NFS export's allowedCidr - must match the actual
  // subnet of the requesting node's own workspace mesh, not always Default's.
  async getVlanSubnet(workspaceId: string): Promise<string> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { isDefault: true, subnetIndex: true },
    });
    if (!workspace) {
      throw new NotFoundException(`Workspace not found: ${workspaceId}`);
    }
    return resolveSubnetCidr(workspace);
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
    await this.flushPendingOfflineAlerts();
  }

  // One Vlan per workspace - `workspace.slug` doubles as the Vlan's unique
  // `name` (the Default workspace's slug is literally 'default', so this
  // reproduces the pre-workspace row/name exactly, no data migration needed).
  async getOrCreateVlan(workspaceId: string): Promise<any> {
    try {
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { id: true, slug: true, isDefault: true, subnetIndex: true },
      });
      if (!workspace) {
        throw new NotFoundException(`Workspace not found: ${workspaceId}`);
      }

      let vlan = await this.prisma.vlan.findFirst({
        where: { workspaceId },
        include: { members: true, connections: true },
      });

      if (!vlan) {
        try {
          vlan = await this.prisma.vlan.create({
            data: {
              workspaceId,
              name: workspace.slug,
              subnetCidr: resolveSubnetCidr(workspace),
              description: `Automated VLAN for workspace ${workspace.slug}`,
            },
            include: { members: true, connections: true },
          });
        } catch (error) {
          if (this.isUniqueConstraintError(error)) {
            vlan = await this.prisma.vlan.findFirst({
              where: { workspaceId },
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

  async joinVlan(nodeId: string, workspaceId: string = DEFAULT_WORKSPACE_ID): Promise<any> {
    const vlan = await this.getOrCreateVlan(workspaceId);

    const existingMember = await this.prisma.vlanMember.findFirst({
      where: { nodeId, vlanId: vlan.id },
    });

    if (existingMember) {
      return existingMember;
    }

    // Check if Node already has a stored VLAN IP from previous join - always
    // reused as-is (never re-derived) so an already-deployed node's address
    // never moves, regardless of how the generation formula below evolves.
    const node = await this.prisma.node.findUnique({ where: { id: nodeId } });
    const vlanIp = node?.vlanIp || this.generateDeterministicVlanIp(nodeId, vlan.subnetCidr);
    const vlanMac = node?.vlanMac || this.generateVlanMac(nodeId);
    this.logger.debug(`joinVlan: creating member vlanId=${vlan.id} vlanIp=${vlanIp} vlanMac=${vlanMac}`);

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
      this.logger.log(`Node ${nodeId} joined VLAN ${vlan.id} as ${vlanIp}`);
    } catch (error) {
      // A concurrent join (two heartbeats racing) loses on the unique index:
      // expected, the winner's row is reused below.
      if (this.isUniqueConstraintError(error)) {
        const existing = await this.prisma.vlanMember.findFirst({
          where: { nodeId, vlanId: vlan.id },
        });
        if (existing) {
          this.logger.debug(`joinVlan: concurrent join, reusing member ${existing.id}`);
          return existing;
        }
      }
      this.logger.error(`joinVlan: cannot create member for node ${nodeId}: ${error instanceof Error ? error.message : error}`);
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

    // Freshness is maintained by the 10s refreshAllVlanConnections cron — refreshing again
    // inline here duplicated that work on every poll from every open dashboard tab.
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
   * sample (throttled to CONNECTION_SAMPLE_THROTTLE_MS per pair, except every
   * real status transition is always recorded), and queues a panel alert on a
   * transition to offline, raised only if the link stays down (never on
   * recovery — matches the failure-only convention used by the other alert
   * producers in this codebase).
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
    const pairKey = [sourceNodeId, targetNodeId].sort().join('__');
    const statusChanged = !!previousStatus && previousStatus !== next.status;
    const lastSampleAt = this.connectionSampleWrittenAt.get(pairKey) ?? 0;
    if (statusChanged || Date.now() - lastSampleAt >= CONNECTION_SAMPLE_THROTTLE_MS) {
      this.connectionSampleWrittenAt.set(pairKey, Date.now());
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
    }

    const directionKey = `${sourceNodeId}:${targetNodeId}`;
    if (next.status !== 'offline') {
      this.pendingOfflineAlerts.delete(directionKey);
      return;
    }
    if (!previousStatus || previousStatus === next.status) return;
    // Only alert on a link actually going down — "degraded" transitions are too noisy
    // (flappy latency/handshake blips) and are tracked in VlanConnectionSample history instead.
    // The alert itself waits until the link has stayed down (flushPendingOfflineAlerts).
    if (!this.pendingOfflineAlerts.has(directionKey)) {
      this.pendingOfflineAlerts.set(directionKey, { vlanId, sourceNodeId, targetNodeId, since: Date.now() });
    }
  }

  /**
   * Raises the alert for links that went offline and stayed offline past
   * CONNECTION_OFFLINE_ALERT_DELAY_MS, once the startup grace is over. A link
   * that recovers in between is dropped from the map by
   * recordConnectionTransition and never alerts.
   */
  private async flushPendingOfflineAlerts(): Promise<void> {
    const now = Date.now();
    if (now - this.bootedAt < CONNECTION_ALERT_STARTUP_GRACE_MS) return;
    for (const [directionKey, pending] of this.pendingOfflineAlerts) {
      if (now - pending.since < CONNECTION_OFFLINE_ALERT_DELAY_MS) continue;
      this.pendingOfflineAlerts.delete(directionKey);
      try {
        await this.raiseOfflineAlert(pending.vlanId, pending.sourceNodeId, pending.targetNodeId);
      } catch (error) {
        this.logger.warn(
          `Failed to raise VLAN offline alert for ${directionKey}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async raiseOfflineAlert(vlanId: string, sourceNodeId: string, targetNodeId: string): Promise<void> {
    // Re-read the link: it may have recovered through a path that skipped the
    // transition hook (e.g. the row was rewritten by a membership change).
    const connection = await this.prisma.vlanConnection.findUnique({
      where: { vlanId_sourceNodeId_targetNodeId: { vlanId, sourceNodeId, targetNodeId } },
      select: { status: true },
    });
    if (connection?.status !== 'offline') return;

    const pairKey = [sourceNodeId, targetNodeId].sort().join('__');
    const cooldownKey = `${pairKey}:offline`;
    const lastAlertAt = this.connectionAlertCooldownAt.get(cooldownKey) ?? 0;
    if (Date.now() - lastAlertAt < CONNECTION_ALERT_COOLDOWN_MS) return;
    this.connectionAlertCooldownAt.set(cooldownKey, Date.now());

    const [source, target] = await Promise.all([
      this.prisma.node.findUnique({ where: { id: sourceNodeId }, select: { name: true, workspaceId: true, vlanIp: true, mutedUntil: true } }),
      this.prisma.node.findUnique({ where: { id: targetNodeId }, select: { name: true, vlanIp: true, mutedUntil: true } }),
    ]);

    const now = Date.now();
    if ((source?.mutedUntil && source.mutedUntil.getTime() > now) || (target?.mutedUntil && target.mutedUntil.getTime() > now)) {
      return;
    }

    const sourceLabel = `${source?.name ?? sourceNodeId} (${source?.vlanIp ?? '?'})`;
    const targetLabel = `${target?.name ?? targetNodeId} (${target?.vlanIp ?? '?'})`;

    await this.prisma.alert.create({
      data: {
        workspaceId: source?.workspaceId ?? DEFAULT_WORKSPACE_ID,
        nodeId: sourceNodeId,
        severity: 'high',
        message: `Lien VLAN hors ligne : ${sourceLabel} ↔ ${targetLabel}`,
      },
    });
  }

  async getConnectionHistory(
    vlanIdOrName: string,
    sourceNodeId: string,
    targetNodeId: string,
    range: string = '1h',
  ): Promise<{ samples: any[]; uptimePercent: number | null; via: Array<{ id: string; name: string }> }> {
    const vlanLookup = await this.prisma.vlan.findFirst({
      where: {
        OR: [{ id: vlanIdOrName }, { name: vlanIdOrName }],
      },
    });

    if (!vlanLookup) {
      throw new Error(`VLAN not found: ${vlanIdOrName}`);
    }

    const resolution = HISTORY_RESOLUTION[range] ?? HISTORY_RESOLUTION['1h'];
    const since = new Date(Date.now() - resolution.rangeMs);
    const members = await this.prisma.vlanMember.findMany({
      where: { vlanId: vlanLookup.id },
      select: {
        node: {
          select: { id: true, name: true, overlayIsGateway: true, overlayIsBackupGateway: true, locationCountryCode: true },
        },
      },
    });
    const nodes = members.map((member) => member.node);
    const via = relayGateways(nodes, this.activeGatewaysFor(vlanLookup.id, nodes), sourceNodeId, targetNodeId).map(
      ({ id, name }) => ({ id, name }),
    );

    let points: LinkHistoryPoint[];
    if (via.length === 0) {
      points = await this.pairHistory(vlanLookup.id, sourceNodeId, targetNodeId, since, resolution.bucketMs);
    } else {
      // Segmented cross-region pair: no tunnel and no probe exist between
      // the two ends, the traffic goes through the regional gateways. Its
      // history is the chain of the hops it actually crosses.
      const hops = [sourceNodeId, ...via.map((gateway) => gateway.id), targetNodeId];
      const segments = await Promise.all(
        hops
          .slice(1)
          .map((nodeId, index) => this.pairHistory(vlanLookup.id, hops[index], nodeId, since, resolution.bucketMs)),
      );
      points = chainSegments(segments, resolution.bucketMs || 60_000);
    }

    return {
      samples: points.map(({ createdAt, status, latencyMs, packetLoss, bandwidth }) => ({
        createdAt,
        status,
        latencyMs,
        packetLoss,
        bandwidth,
      })),
      uptimePercent: uptimePercent(points),
      via,
    };
  }

  /**
   * A pair's history at the requested resolution (bucketMs 0 = raw samples).
   * Samples are throttled per unordered pair (recordConnectionTransition), so
   * a link's history lands under whichever direction reported first: both
   * directions are read as one series. Raw samples only live
   * RAW_SAMPLE_RETENTION_MS, older hours come from VlanConnectionRollup.
   */
  private async pairHistory(
    vlanId: string,
    a: string,
    b: string,
    since: Date,
    bucketMs: number,
  ): Promise<LinkHistoryPoint[]> {
    const pairWhere = Prisma.sql`"vlanId" = ${vlanId} AND (("sourceNodeId" = ${a} AND "targetNodeId" = ${b}) OR ("sourceNodeId" = ${b} AND "targetNodeId" = ${a}))`;
    if (bucketMs === 0) {
      const samples = await this.prisma.vlanConnectionSample.findMany({
        where: {
          vlanId,
          createdAt: { gte: since },
          OR: [
            { sourceNodeId: a, targetNodeId: b },
            { sourceNodeId: b, targetNodeId: a },
          ],
        },
        // Newest first so a burst of transitions can never push the latest
        // samples out of the window.
        orderBy: { createdAt: 'desc' },
        take: 1000,
      });
      return samples.reverse().map((sample) => ({
        createdAt: sample.createdAt,
        status: sample.status,
        latencyMs: sample.latencyMs,
        packetLoss: sample.packetLoss,
        bandwidth: sample.bandwidth,
        total: 1,
        healthy: sample.status === 'healthy' ? 1 : 0,
      }));
    }

    // Raw samples cover the recent part, rollups (whole past hours) the rest.
    const rawFrom = new Date(
      Math.max(since.getTime(), floorTo(Date.now() - RAW_SAMPLE_RETENTION_MS, HOUR_MS) + HOUR_MS),
    );
    const bucket = Prisma.sql`date_bin(make_interval(secs => ${bucketMs / 1000}), "createdAt", TIMESTAMP '2000-01-01')`;
    const raw = await this.prisma.$queryRaw<BucketRow[]>`
      SELECT ${bucket} AS "createdAt",
             count(*)::int AS "total",
             (count(*) FILTER (WHERE "status" = 'healthy'))::int AS "healthy",
             max(${SEVERITY_SQL}) AS "severity",
             avg("latencyMs") AS "latencyMs",
             avg("packetLoss") AS "packetLoss",
             avg("bandwidth") AS "bandwidth"
      FROM "VlanConnectionSample"
      WHERE ${pairWhere} AND "createdAt" >= ${rawFrom}
      GROUP BY 1
      ORDER BY 1`;
    const rolled =
      rawFrom.getTime() > since.getTime()
        ? await this.prisma.$queryRaw<BucketRow[]>`
            SELECT date_bin(make_interval(secs => ${bucketMs / 1000}), "bucketStart", TIMESTAMP '2000-01-01') AS "createdAt",
                   sum("sampleCount")::int AS "total",
                   sum("healthyCount")::int AS "healthy",
                   max(CASE "worstStatus" WHEN 'healthy' THEN 1 WHEN 'unknown' THEN 2 WHEN 'degraded' THEN 3 ELSE 4 END) AS "severity",
                   sum("latencyMs" * "sampleCount") / NULLIF(sum("sampleCount") FILTER (WHERE "latencyMs" IS NOT NULL), 0) AS "latencyMs",
                   sum("packetLoss" * "sampleCount") / NULLIF(sum("sampleCount") FILTER (WHERE "packetLoss" IS NOT NULL), 0) AS "packetLoss",
                   avg("bandwidth") AS "bandwidth"
            FROM "VlanConnectionRollup"
            WHERE "vlanId" = ${vlanId} AND "sourceNodeId" = ${a < b ? a : b} AND "targetNodeId" = ${a < b ? b : a}
              AND "bucketStart" >= ${floorToDate(since, HOUR_MS)} AND "bucketStart" < ${rawFrom}
            GROUP BY 1
            ORDER BY 1`
        : [];
    return [...rolled, ...raw].map((row) => ({
      createdAt: row.createdAt,
      status: SEVERITY_STATUS[Number(row.severity) - 1] ?? 'unknown',
      latencyMs: row.latencyMs == null ? null : Math.round(Number(row.latencyMs) * 100) / 100,
      packetLoss: row.packetLoss == null ? null : Math.round(Number(row.packetLoss) * 100) / 100,
      bandwidth: row.bandwidth == null ? null : Math.round(Number(row.bandwidth) * 100) / 100,
      total: row.total,
      healthy: row.healthy,
    }));
  }

  /**
   * Folds raw samples into hourly VlanConnectionRollup rows. Recomputes every
   * completed hour still covered by raw samples, so a missed run or a late
   * sample is simply caught up next time (upsert, idempotent).
   */
  @Cron('5 * * * *')
  async rollUpConnectionSamples() {
    const until = floorToDate(new Date(), HOUR_MS);
    const from = new Date(until.getTime() - RAW_SAMPLE_RETENTION_MS);
    await this.prisma.$executeRaw`
      INSERT INTO "VlanConnectionRollup" ("id", "vlanId", "sourceNodeId", "targetNodeId", "bucketStart", "sampleCount", "healthyCount", "worstStatus", "latencyMs", "packetLoss", "bandwidth")
      SELECT gen_random_uuid()::text,
             "vlanId",
             LEAST("sourceNodeId", "targetNodeId"),
             GREATEST("sourceNodeId", "targetNodeId"),
             date_trunc('hour', "createdAt"),
             count(*)::int,
             (count(*) FILTER (WHERE "status" = 'healthy'))::int,
             (ARRAY['healthy', 'unknown', 'degraded', 'offline'])[max(${SEVERITY_SQL})]::"VlanConnectionStatus",
             avg("latencyMs"),
             avg("packetLoss"),
             avg("bandwidth")
      FROM "VlanConnectionSample"
      WHERE "createdAt" >= ${from} AND "createdAt" < ${until}
      GROUP BY 2, 3, 4, 5
      ON CONFLICT ("vlanId", "sourceNodeId", "targetNodeId", "bucketStart") DO UPDATE SET
        "sampleCount" = EXCLUDED."sampleCount",
        "healthyCount" = EXCLUDED."healthyCount",
        "worstStatus" = EXCLUDED."worstStatus",
        "latencyMs" = EXCLUDED."latencyMs",
        "packetLoss" = EXCLUDED."packetLoss",
        "bandwidth" = EXCLUDED."bandwidth"`;
  }

  // Raw samples go after 48 h (the hourly rollups keep the long history),
  // rollups after CONNECTION_ROLLUP_RETENTION_DAYS. Runs after the rollup of
  // the same hour, which has already folded anything about to be deleted.
  @Cron('15 * * * *')
  async pruneOldConnectionSamples() {
    const rawCutoff = new Date(Date.now() - RAW_SAMPLE_RETENTION_MS);
    const { count } = await this.prisma.vlanConnectionSample.deleteMany({ where: { createdAt: { lt: rawCutoff } } });
    const rollupCutoff = new Date(Date.now() - CONNECTION_ROLLUP_RETENTION_DAYS * 24 * HOUR_MS);
    const { count: rollups } = await this.prisma.vlanConnectionRollup.deleteMany({
      where: { bucketStart: { lt: rollupCutoff } },
    });
    if (count > 0 || rollups > 0) {
      this.logger.log(`Pruned ${count} raw VLAN connection sample(s) and ${rollups} hourly rollup(s)`);
    }
  }

  /**
   * Sets a node's gateway role in its region: 'primary' (used by cross-region
   * segmentation in planOverlayPeers), 'backup' (takes over while the primary
   * is offline, see AgentsService.checkGatewayFailover) or null. One node per
   * role and region within a VLAN - assigning a role takes it from whichever
   * node held it. Actual WireGuard reconfiguration is triggered by the caller
   * (AgentsService), not here.
   */
  async setGateway(
    vlanIdOrName: string,
    nodeId: string,
    role: GatewayRole | null,
  ): Promise<{ nodeId: string; role: GatewayRole | null; region: Region | null }> {
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
    if (role && !region) {
      throw new Error(
        "Impossible de désigner ce nœud comme passerelle : sa région ne peut pas être déterminée (localisation manquante)",
      );
    }

    if (role && region) {
      const field = role === 'primary' ? 'overlayIsGateway' : 'overlayIsBackupGateway';
      const otherMembers = await this.prisma.vlanMember.findMany({
        where: { vlanId: vlan.id, nodeId: { not: nodeId } },
        include: { node: true },
      });
      const idsToClear = otherMembers
        .filter((m) => m.node[field] && resolveRegion(m.node.locationCountryCode) === region)
        .map((m) => m.nodeId);
      if (idsToClear.length > 0) {
        await this.prisma.node.updateMany({ where: { id: { in: idsToClear } }, data: { [field]: false } });
      }
    }

    await this.prisma.node.update({
      where: { id: nodeId },
      data: { overlayIsGateway: role === 'primary', overlayIsBackupGateway: role === 'backup' },
    });
    // Roles changed under the watcher: start the region from its primary.
    if (region) this.failedOverRegions.get(vlan.id)?.delete(region);

    return { nodeId, role, region };
  }

  /**
   * Regions currently routed through their backup gateway, per VLAN. Kept in
   * memory only: after a restart every region starts on its primary and the
   * watcher fails over again if that primary is still down.
   */
  private readonly failedOverRegions = new Map<string, Set<Region>>();

  isFailedOver(vlanId: string, region: Region) {
    return this.failedOverRegions.get(vlanId)?.has(region) ?? false;
  }

  setFailedOver(vlanId: string, region: Region, failedOver: boolean) {
    const regions = this.failedOverRegions.get(vlanId) ?? new Set<Region>();
    if (failedOver) regions.add(region);
    else regions.delete(region);
    this.failedOverRegions.set(vlanId, regions);
  }

  activeGatewaysFor(
    vlanId: string,
    nodes: Array<{ id: string; overlayIsGateway: boolean; overlayIsBackupGateway: boolean; locationCountryCode: string | null }>,
  ) {
    return activeGateways(
      nodes.map((node) => ({
        nodeId: node.id,
        region: resolveRegion(node.locationCountryCode),
        isPrimary: node.overlayIsGateway,
        isBackup: node.overlayIsBackupGateway,
      })),
      this.failedOverRegions.get(vlanId) ?? new Set(),
    );
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
    // Freshness is maintained by the 10s refreshAllVlanConnections cron — refreshing again
    // inline here duplicated that work on every poll from every open dashboard tab.

    const [vlan, members, connections] = await Promise.all([
      this.prisma.vlan.findUnique({
        where: { id: vlanId },
        include: { members: { include: { node: true } } }
      }),
      this.prisma.vlanMember.count({ where: { vlanId } }),
      this.prisma.vlanConnection.findMany({
        where: { vlanId },
        select: { status: true },
      }),
    ]);

    const healthyConnections = connections.filter((c) => c.status === 'healthy').length;
    const degradedConnections = connections.filter((c) => c.status === 'degraded').length;
    const offlineConnections = connections.filter((c) => c.status === 'offline').length;

    const active = vlan ? new Set(this.activeGatewaysFor(vlanId, vlan.members.map((member) => member.node)).values()) : new Set();
    const vlanWithRegions = vlan
      ? {
          ...vlan,
          members: (vlan.members ?? []).map((member: any) => ({
            ...this.withRegion(member),
            gatewayActive: active.has(member.nodeId),
          })),
        }
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
    };
  }

  private withRegion<T extends { node?: { locationCountryCode?: string | null } | null }>(
    member: T,
  ): T & { region: Region | null } {
    return { ...member, region: resolveRegion(member.node?.locationCountryCode) };
  }

  private generateVlanIp(index: number, baseIp: number): string {
    const ipNum = baseIp + index;
    return [
      (ipNum >>> 24) & 0xff,
      (ipNum >>> 16) & 0xff,
      (ipNum >>> 8) & 0xff,
      ipNum & 0xff,
    ].join('.');
  }

  // subnetCidr must be the joining node's own workspace's Vlan.subnetCidr -
  // for the Default workspace this parses back to the exact same BASE_IP
  // (0x0aff0002) the old hardcoded constant used, so already-deployed nodes'
  // addresses are unaffected (verified byte-for-byte against production data
  // before this went out - see the Phase 2 rollout notes).
  private generateDeterministicVlanIp(nodeId: string, subnetCidr: string): string {
    // Hash nodeId to get deterministic offset (ensures same IP on restart)
    let hash = 0;
    for (let i = 0; i < nodeId.length; i++) {
      hash = ((hash << 5) - hash) + nodeId.charCodeAt(i);
      hash |= 0;
    }
    // Map hash to index 1-253 (skip 0=gateway, 254=broadcast)
    const index = (Math.abs(hash) % 253) + 1;
    return this.generateVlanIp(index, parseBaseIp(subnetCidr));
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

    await Promise.all(
      transitions.map((transition) =>
        this.recordConnectionTransition(
          vlanId,
          transition.sourceNodeId,
          transition.targetNodeId,
          transition.previousStatus,
          transition.next,
        ),
      ),
    );
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
