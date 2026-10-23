import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NodeStatus, Prisma } from '@prisma/client';
import { AgentTokenService } from '../agents/agent-token.service';
import { AgentsService } from '../agents/agents.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { scopeWhere, scopeWhereViaNode, WorkspaceScope } from '../auth/workspace.guard';
import { getControlPlaneVersion, isKnownControlPlaneVersion } from '../common/build-info';
import { slugify } from '../common/slugify';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNodeDto } from './dto/create-node.dto';
import { UpdateNodeDto } from './dto/update-node.dto';
import { extractExternalIp } from './extract-external-ip';

type ActivityNode = {
  id: string;
  name: string;
  role: string;
  status: NodeStatus;
  lastSeenAt: Date | null;
  overlayEndpoint: string | null;
  agentVersion: string | null;
  agentVersionAt: Date | null;
  mutedUntil: Date | null;
  locationCity: string | null;
  locationCountry: string | null;
  locationCountryCode: string | null;
  locationLat: number | null;
  locationLng: number | null;
  vlanIp: string | null;
  dnsHostname: string | null;
  internalDnsForwarderStatus: string | null;
  internalDnsForwarderConflict: unknown;
};

type ActivitySample = {
  nodeId: string;
  cpu: number;
  ram: number;
  disk: number;
  networkRx: number;
  networkTx: number;
  ioRead: number;
  ioWrite: number;
  createdAt: Date;
};

type ActivityDisk = {
  id: string;
  nodeId: string;
  name: string;
  mountPath: string;
  type: string;
  health: string;
  capacityGb: number;
  usedGb: number;
  updatedAt: Date;
  physicalDisks: string[];
  node?: { name: string } | null;
};

type ActivitySmartReport = {
  nodeId: string;
  diskName: string;
  temperatureC: number;
  reallocatedSectors: number;
  pendingSectors: number;
  powerOnHours: number;
  overall: string;
  collectedAt: Date;
};

@Injectable()
export class NodesService implements OnModuleInit {
  private readonly logger = new Logger(NodesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly agentsService: AgentsService,
    private readonly agentTokenService: AgentTokenService,
  ) {}

  list(scope: WorkspaceScope) {
    return this.prisma.node.findMany({ where: scopeWhere(scope), orderBy: { createdAt: 'desc' } });
  }

  private async assertOwned(id: string, scope: WorkspaceScope) {
    const node = await this.prisma.node.findFirst({ where: { id, workspaceId: scope.workspaceId }, select: { id: true } });
    if (!node) throw new NotFoundException('node not found');
  }

  async create(dto: CreateNodeDto, scope: WorkspaceScope, actorUserId?: string) {
    const created = await this.prisma.node.create({
      data: {
        workspaceId: scope.workspaceId as string,
        name: dto.name,
        role: dto.role,
        status: (dto.status as NodeStatus | undefined) ?? 'offline',
      },
    });

    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'node.create',
      resourceType: 'node',
      resourceId: created.id,
      details: { name: created.name, role: created.role },
    });

    return created;
  }

  async update(id: string, dto: UpdateNodeDto, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertOwned(id, scope);
    const locationCountryCode =
      dto.locationCountryCode === undefined
        ? undefined
        : dto.locationCountryCode === null
          ? null
          : dto.locationCountryCode.trim().toUpperCase().slice(0, 2) || null;

    const data: Prisma.NodeUpdateInput = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.role !== undefined ? { role: dto.role } : {}),
      ...(dto.status !== undefined ? { status: dto.status as NodeStatus } : {}),
      ...(dto.locationCity !== undefined ? { locationCity: dto.locationCity?.trim() || null } : {}),
      ...(dto.locationCountry !== undefined ? { locationCountry: dto.locationCountry?.trim() || null } : {}),
      ...(locationCountryCode !== undefined ? { locationCountryCode } : {}),
      ...(dto.locationLat !== undefined ? { locationLat: dto.locationLat } : {}),
      ...(dto.locationLng !== undefined ? { locationLng: dto.locationLng } : {}),
      ...(dto.graphX !== undefined ? { graphX: dto.graphX } : {}),
      ...(dto.graphY !== undefined ? { graphY: dto.graphY } : {}),
      // Slugified server-side (not just trusted from the frontend) since
      // this value flows directly into a DNS record name.
      ...(dto.dnsHostname !== undefined ? { dnsHostname: dto.dnsHostname ? slugify(dto.dnsHostname) || null : null } : {}),
    };

    const updated = await this.prisma.node.update({ where: { id }, data });

    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'node.update',
      resourceType: 'node',
      resourceId: updated.id,
      details: dto as unknown as Prisma.InputJsonValue,
    });

    return updated;
  }

  async delete(id: string, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertOwned(id, scope);
    const deleted = await this.prisma.node.delete({ where: { id } });

    const uninstall = this.agentsService.triggerAgentUninstall(id);
    if (!uninstall.queued) {
      this.logger.warn(`Node ${id}: agent offline, could not send uninstall command (${uninstall.message})`);
    }

    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'node.delete',
      resourceType: 'node',
      resourceId: deleted.id,
    });

    return { ...deleted, agentUninstallQueued: uninstall.queued };
  }

  async mute(id: string, minutes: number, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertOwned(id, scope);
    const mutedUntil = new Date(Date.now() + minutes * 60_000);
    const updated = await this.prisma.node.update({ where: { id }, data: { mutedUntil } });

    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'node.mute',
      resourceType: 'node',
      resourceId: id,
      details: { minutes, mutedUntil: mutedUntil.toISOString() },
    });

    return updated;
  }

  async unmute(id: string, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertOwned(id, scope);
    const updated = await this.prisma.node.update({ where: { id }, data: { mutedUntil: null } });

    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'node.unmute',
      resourceType: 'node',
      resourceId: id,
    });

    return updated;
  }

  async rotateAgentToken(id: string, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertOwned(id, scope);
    const { rotated, delivered } = await this.agentTokenService.rotate(id);
    if (!rotated) {
      throw new NotFoundException('node not found');
    }

    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'node.rotate_agent_token',
      resourceType: 'node',
      resourceId: id,
      details: { delivered },
    });

    return { delivered };
  }

  async rotateAllAgentTokens(scope: WorkspaceScope, actorUserId?: string) {
    const results = await this.agentTokenService.rotateAll(scopeWhere(scope));

    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'node.rotate_agent_token_all',
      resourceType: 'node',
      details: { count: results.length, delivered: results.filter((r) => r.delivered).length },
    });

    return results;
  }

  async activity(range: string, scope: WorkspaceScope) {
    const now = Date.now();
    const ranges: Record<string, number> = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
    };
    const ms = ranges[range] ?? ranges['1h'];

    const workspaceId = scope.workspaceId as string;

    // The two "latest row per group" lookups below are raw DISTINCT ON
    // queries rather than Prisma's `distinct`, because Prisma applies
    // `distinct` IN MEMORY: it fetches every matching row, ships it all to
    // Node, and only then dedupes. For the SMART reports that meant reading
    // the ENTIRE SmartReport table (no time filter, one row per disk every
    // 20s per node, no retention until now) on every 5s poll of this
    // endpoint - the single reason /nodes/activity took ~45-60s in
    // production. DISTINCT ON lets PostgreSQL walk the existing
    // (nodeId, diskName, collectedAt) / (nodeId, createdAt) indexes and
    // return only the handful of rows actually used.
    const [nodes, latestSamples, disks, smartReports] = (await Promise.all([
      this.prisma.node.findMany({ where: scopeWhere(scope), orderBy: { createdAt: 'desc' } }),
      this.prisma.$queryRaw<ActivitySample[]>`
        SELECT DISTINCT ON (s."nodeId")
          s."nodeId", s."cpu", s."ram", s."disk", s."networkRx", s."networkTx",
          s."ioRead", s."ioWrite", s."createdAt"
        FROM "MetricSample" s
        JOIN "Node" n ON n."id" = s."nodeId"
        WHERE n."workspaceId" = ${workspaceId}
          AND s."createdAt" >= ${new Date(now - ms)}
        ORDER BY s."nodeId", s."createdAt" DESC
      `,
      this.prisma.disk.findMany({
        where: scopeWhereViaNode(scope),
        include: { node: true },
        orderBy: [{ nodeId: 'asc' }, { mountPath: 'asc' }],
      }),
      this.prisma.$queryRaw<ActivitySmartReport[]>`
        SELECT DISTINCT ON (r."nodeId", r."diskName")
          r."nodeId", r."diskName", r."temperatureC", r."reallocatedSectors",
          r."pendingSectors", r."powerOnHours", r."overall", r."collectedAt"
        FROM "SmartReport" r
        JOIN "Node" n ON n."id" = r."nodeId"
        WHERE n."workspaceId" = ${workspaceId}
        ORDER BY r."nodeId", r."diskName", r."collectedAt" DESC
      `,
    ])) as [ActivityNode[], ActivitySample[], ActivityDisk[], ActivitySmartReport[]];

    const sampleByNode = new Map(latestSamples.map((sample) => [sample.nodeId, sample]));
    const disksByNode = new Map<string, Array<(typeof disks)[number]>>();

    for (const disk of disks) {
      const list = disksByNode.get(disk.nodeId) ?? [];
      list.push(disk);
      disksByNode.set(disk.nodeId, list);
    }

    // SmartReport.diskName is the physical block device (e.g. "sda", "nvme0n1")
    // while Disk.name is the mounted partition or, for software RAID (mdadm),
    // the "mdX" array name — neither of which textually relates to the
    // physical disk. Disk.physicalDisks (populated by the agent by resolving
    // partitions and RAID members down to their real block device) is the
    // join key; see the fallback below for pre-physicalDisks agent reports.
    const smartReportsByNode = new Map<string, ActivitySmartReport[]>();
    for (const report of smartReports) {
      const list = smartReportsByNode.get(report.nodeId) ?? [];
      list.push(report);
      smartReportsByNode.set(report.nodeId, list);
    }

    const rawControlVersion = getControlPlaneVersion();
    const controlVersionKnown = isKnownControlPlaneVersion(rawControlVersion);
    // Exposed as null (never the raw "unknown" sentinel) when the control
    // plane's own version couldn't be determined - see build-info.ts. An
    // agent can't meaningfully be "up to date" or "obsolete" relative to a
    // reference the server itself doesn't know, so agentUpToDate stays null
    // (unknown) rather than comparing against the sentinel string.
    const controlVersion = controlVersionKnown ? rawControlVersion : null;

    return nodes.map((node) => {
      const sample = sampleByNode.get(node.id);
      const nodeDisks = disksByNode.get(node.id) ?? [];
      const totalCapacityGb = nodeDisks.reduce((acc, disk) => acc + disk.capacityGb, 0);
      const totalUsedGb = nodeDisks.reduce((acc, disk) => acc + disk.usedGb, 0);
      const usageRatio = totalCapacityGb > 0 ? totalUsedGb / totalCapacityGb : 0;

      return {
        id: node.id,
        name: node.name,
        role: node.role,
        status: node.status,
        lastSeenAt: node.lastSeenAt?.toISOString() ?? null,
        overlayEndpoint: node.overlayEndpoint,
        externalIp: this.extractExternalIp(node.overlayEndpoint),
        locationCity: node.locationCity,
        locationCountry: node.locationCountry,
        locationCountryCode: node.locationCountryCode,
        locationLat: node.locationLat,
        locationLng: node.locationLng,
        agentVersion: node.agentVersion,
        agentVersionAt: node.agentVersionAt?.toISOString() ?? null,
        mutedUntil: node.mutedUntil?.toISOString() ?? null,
        vlanIp: node.vlanIp,
        dnsHostname: node.dnsHostname,
        internalDnsForwarderStatus: node.internalDnsForwarderStatus,
        internalDnsForwarderConflict: node.internalDnsForwarderConflict,
        controlVersion,
        agentUpToDate: node.agentVersion && controlVersion ? node.agentVersion === controlVersion : null,
        metrics: sample
          ? {
              cpu: sample.cpu,
              ram: sample.ram,
              disk: sample.disk,
              networkRx: sample.networkRx,
              networkTx: sample.networkTx,
              ioRead: sample.ioRead,
              ioWrite: sample.ioWrite,
              sampledAt: sample.createdAt.toISOString(),
            }
          : {
              cpu: 0,
              ram: 0,
              disk: 0,
              networkRx: 0,
              networkTx: 0,
              ioRead: 0,
              ioWrite: 0,
              sampledAt: null,
            },
        storage: {
          totalCapacityGb,
          totalUsedGb,
          usageRatio,
          diskCount: nodeDisks.length,
          disks: nodeDisks.map((disk) => {
            const nodeSmartReports = smartReportsByNode.get(disk.nodeId) ?? [];
            const smart =
              disk.physicalDisks.length > 0
                ? nodeSmartReports.find((report) => disk.physicalDisks.includes(report.diskName))
                : // Fallback for disks reported by an agent build before physicalDisks
                  // existed: approximate the old (RAID-unaware) prefix match.
                  nodeSmartReports.find((report) => disk.name.startsWith(report.diskName));
            return {
              id: disk.id,
              name: disk.name,
              mountPath: disk.mountPath,
              type: disk.type,
              health: disk.health,
              capacityGb: disk.capacityGb,
              usedGb: disk.usedGb,
              usageRatio: disk.capacityGb > 0 ? disk.usedGb / disk.capacityGb : 0,
              updatedAt: disk.updatedAt.toISOString(),
              nodeName: disk.node?.name ?? disk.nodeId,
              smartDiskName: smart?.diskName ?? null,
              smart: smart
                ? {
                    temperatureC: smart.temperatureC,
                    reallocatedSectors: smart.reallocatedSectors,
                    pendingSectors: smart.pendingSectors,
                    powerOnHours: smart.powerOnHours,
                    overall: smart.overall,
                    collectedAt: smart.collectedAt.toISOString(),
                  }
                : null,
            };
          }),
        },
      };
    });
  }

  async smartHistory(nodeId: string, diskName: string, scope: WorkspaceScope) {
    await this.assertOwned(nodeId, scope);
    const reports = await this.prisma.smartReport.findMany({
      where: { nodeId, diskName },
      orderBy: { collectedAt: 'desc' },
      take: 200,
    });

    return reports
      .map((report) => ({
        collectedAt: report.collectedAt.toISOString(),
        temperatureC: report.temperatureC,
        reallocatedSectors: report.reallocatedSectors,
        pendingSectors: report.pendingSectors,
        powerOnHours: report.powerOnHours,
        overall: report.overall,
      }))
      .reverse();
  }

  private extractExternalIp(endpoint: string | null | undefined) {
    return extractExternalIp(endpoint);
  }

  // Always the most recent samples in range, downsampled server-side so the
  // full requested window is represented at a manageable point count instead
  // of either (a) shipping thousands of raw 5s-cadence rows for a 24h range,
  // or (b) silently truncating to a slice of the window. A prior version
  // here used `orderBy: 'asc', take: 500`, which for any range wider than
  // ~42min (500 samples * 5s) returned the OLDEST 500 samples in the window
  // - so 6h/24h charts were frozen on data up to hours stale even though
  // fresh samples were being written every 5s.
  private static readonly METRICS_TARGET_POINTS = 180;
  private static readonly METRICS_FETCH_CAP = 2000;

  async metrics(id: string, range: string, scope: WorkspaceScope) {
    await this.assertOwned(id, scope);
    const now = Date.now();
    const ranges: Record<string, number> = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
    };
    const ms = ranges[range] ?? ranges['1h'];

    const samples = await this.prisma.metricSample.findMany({
      where: { nodeId: id, createdAt: { gte: new Date(now - ms) } },
      orderBy: { createdAt: 'desc' },
      take: NodesService.METRICS_FETCH_CAP,
    });
    samples.reverse(); // chronological order, as the frontend expects

    if (samples.length <= NodesService.METRICS_TARGET_POINTS) {
      return samples;
    }

    const bucketSize = Math.ceil(samples.length / NodesService.METRICS_TARGET_POINTS);
    const numericKeys = ['cpu', 'ram', 'disk', 'networkRx', 'networkTx', 'ioRead', 'ioWrite'] as const;
    const buckets: (typeof samples)[number][] = [];
    for (let i = 0; i < samples.length; i += bucketSize) {
      const chunk = samples.slice(i, i + bucketSize);
      const last = chunk[chunk.length - 1];
      const averaged = { ...last };
      for (const key of numericKeys) {
        averaged[key] = chunk.reduce((sum, sample) => sum + sample[key], 0) / chunk.length;
      }
      buckets.push(averaged);
    }
    return buckets;
  }

  // One row per node per 5s heartbeat with no retention would grow forever
  // (~17,280 rows/node/day) - same problem AgentLog already solved with its
  // own daily pruning cron (see agent-logs.service.ts's pruneOldLogs), just
  // mirrored here. 3 days gives headroom past the longest UI range (24h).
  private static readonly METRIC_SAMPLE_RETENTION_DAYS = 3;

  @Cron(CronExpression.EVERY_HOUR)
  async pruneOldMetricSamples() {
    const cutoff = new Date(Date.now() - NodesService.METRIC_SAMPLE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.metricSample.deleteMany({ where: { createdAt: { lt: cutoff } } });
    if (count > 0) {
      this.logger.log(`Pruned ${count} metric sample(s) older than ${NodesService.METRIC_SAMPLE_RETENTION_DAYS} days`);
    }
  }

  // SmartReport had no retention at all while every agent appends one row
  // per disk every 20s (see the agent's stateTicker), so the table grew
  // without bound - millions of rows that /nodes/activity then had to read
  // in full on every poll. 7 days comfortably covers smartHistory's
  // `take: 200` window (200 points at the deduped write cadence below) and
  // keeps the table in the low thousands of rows.
  private static readonly SMART_REPORT_RETENTION_DAYS = 7;
  // Deleting a multi-million-row backlog in a single statement would hold a
  // long transaction and a lot of locks on first run; chunking keeps each
  // statement short enough to stay out of the way of live agent writes.
  private static readonly PRUNE_BATCH_SIZE = 20_000;

  @Cron(CronExpression.EVERY_HOUR)
  async pruneOldSmartReports() {
    const cutoff = new Date(Date.now() - NodesService.SMART_REPORT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    let total = 0;
    for (;;) {
      const deleted = await this.prisma.$executeRaw`
        DELETE FROM "SmartReport"
        WHERE "id" IN (
          SELECT "id" FROM "SmartReport"
          WHERE "collectedAt" < ${cutoff}
          LIMIT ${NodesService.PRUNE_BATCH_SIZE}
        )
      `;
      total += deleted;
      if (deleted < NodesService.PRUNE_BATCH_SIZE) break;
    }
    if (total > 0) {
      this.logger.log(`Pruned ${total} SMART report(s) older than ${NodesService.SMART_REPORT_RETENTION_DAYS} days`);
    }
  }

  // The hourly crons above only start firing an hour after boot, which on
  // the deploy that introduces SMART retention would leave the existing
  // backlog (and the slow /nodes/activity it causes) in place for that
  // whole hour. Run both once at startup, detached so a slow first prune
  // never delays the app coming up.
  onModuleInit() {
    void this.pruneOldSmartReports().catch((error) =>
      this.logger.error(`Initial SMART report prune failed: ${String(error)}`),
    );
    void this.pruneOldMetricSamples().catch((error) =>
      this.logger.error(`Initial metric sample prune failed: ${String(error)}`),
    );
  }
}
