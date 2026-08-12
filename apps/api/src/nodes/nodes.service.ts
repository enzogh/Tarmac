import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NodeStatus, Prisma } from '@prisma/client';
import { AgentTokenService } from '../agents/agent-token.service';
import { AgentsService } from '../agents/agents.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { getControlPlaneVersion } from '../common/build-info';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_WORKSPACE_ID } from '../workspaces/default-workspace';
import { CreateNodeDto } from './dto/create-node.dto';
import { UpdateNodeDto } from './dto/update-node.dto';

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
export class NodesService {
  private readonly logger = new Logger(NodesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly agentsService: AgentsService,
    private readonly agentTokenService: AgentTokenService,
  ) {}

  list() {
    return this.prisma.node.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async create(dto: CreateNodeDto, actorUserId?: string) {
    const created = await this.prisma.node.create({
      data: {
        workspaceId: DEFAULT_WORKSPACE_ID,
        name: dto.name,
        role: dto.role,
        status: (dto.status as NodeStatus | undefined) ?? 'offline',
      },
    });

    await this.auditLogsService.log({
      actorUserId,
      action: 'node.create',
      resourceType: 'node',
      resourceId: created.id,
      details: { name: created.name, role: created.role },
    });

    return created;
  }

  async update(id: string, dto: UpdateNodeDto, actorUserId?: string) {
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
    };

    const updated = await this.prisma.node.update({ where: { id }, data });

    await this.auditLogsService.log({
      actorUserId,
      action: 'node.update',
      resourceType: 'node',
      resourceId: updated.id,
      details: dto as unknown as Prisma.InputJsonValue,
    });

    return updated;
  }

  async delete(id: string, actorUserId?: string) {
    const deleted = await this.prisma.node.delete({ where: { id } });

    const uninstall = this.agentsService.triggerAgentUninstall(id);
    if (!uninstall.queued) {
      this.logger.warn(`Node ${id}: agent offline, could not send uninstall command (${uninstall.message})`);
    }

    await this.auditLogsService.log({
      actorUserId,
      action: 'node.delete',
      resourceType: 'node',
      resourceId: deleted.id,
    });

    return { ...deleted, agentUninstallQueued: uninstall.queued };
  }

  async mute(id: string, minutes: number, actorUserId?: string) {
    const mutedUntil = new Date(Date.now() + minutes * 60_000);
    const updated = await this.prisma.node.update({ where: { id }, data: { mutedUntil } });

    await this.auditLogsService.log({
      actorUserId,
      action: 'node.mute',
      resourceType: 'node',
      resourceId: id,
      details: { minutes, mutedUntil: mutedUntil.toISOString() },
    });

    return updated;
  }

  async unmute(id: string, actorUserId?: string) {
    const updated = await this.prisma.node.update({ where: { id }, data: { mutedUntil: null } });

    await this.auditLogsService.log({
      actorUserId,
      action: 'node.unmute',
      resourceType: 'node',
      resourceId: id,
    });

    return updated;
  }

  async rotateAgentToken(id: string, actorUserId?: string) {
    const { rotated, delivered } = await this.agentTokenService.rotate(id);
    if (!rotated) {
      throw new NotFoundException('node not found');
    }

    await this.auditLogsService.log({
      actorUserId,
      action: 'node.rotate_agent_token',
      resourceType: 'node',
      resourceId: id,
      details: { delivered },
    });

    return { delivered };
  }

  async rotateAllAgentTokens(actorUserId?: string) {
    const results = await this.agentTokenService.rotateAll();

    await this.auditLogsService.log({
      actorUserId,
      action: 'node.rotate_agent_token_all',
      resourceType: 'node',
      details: { count: results.length, delivered: results.filter((r) => r.delivered).length },
    });

    return results;
  }

  async activity(range: string) {
    const now = Date.now();
    const ranges: Record<string, number> = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
    };
    const ms = ranges[range] ?? ranges['1h'];

    const [nodes, latestSamples, disks, smartReports] = (await Promise.all([
      this.prisma.node.findMany({ orderBy: { createdAt: 'desc' } }),
      this.prisma.metricSample.findMany({
        where: { createdAt: { gte: new Date(now - ms) } },
        orderBy: [{ nodeId: 'asc' }, { createdAt: 'desc' }],
        distinct: ['nodeId'],
      }),
      this.prisma.disk.findMany({
        include: { node: true },
        orderBy: [{ nodeId: 'asc' }, { mountPath: 'asc' }],
      }),
      this.prisma.smartReport.findMany({
        orderBy: [{ nodeId: 'asc' }, { diskName: 'asc' }, { collectedAt: 'desc' }],
        distinct: ['nodeId', 'diskName'],
      }),
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

    const controlVersion = getControlPlaneVersion();

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
        controlVersion,
        agentUpToDate: node.agentVersion ? node.agentVersion === controlVersion : null,
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

  async smartHistory(nodeId: string, diskName: string) {
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
    if (!endpoint) return null;
    const raw = endpoint.trim();
    if (!raw) return null;

    try {
      const withScheme = raw.includes('://') ? raw : `udp://${raw}`;
      return new URL(withScheme).hostname || null;
    } catch {
      if (raw.startsWith('[')) {
        const closeBracket = raw.indexOf(']');
        if (closeBracket > 1) {
          return raw.slice(1, closeBracket);
        }
      }
      const slashIndex = raw.indexOf('/');
      const hostPort = slashIndex >= 0 ? raw.slice(0, slashIndex) : raw;
      const parts = hostPort.split(':');
      if (parts.length === 2 && /^\d+$/.test(parts[1])) {
        return parts[0] || null;
      }
      return hostPort || null;
    }
  }

  metrics(id: string, range: string) {
    const now = Date.now();
    const ranges: Record<string, number> = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
    };
    const ms = ranges[range] ?? ranges['1h'];

    return this.prisma.metricSample.findMany({
      where: { nodeId: id, createdAt: { gte: new Date(now - ms) } },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
  }
}
