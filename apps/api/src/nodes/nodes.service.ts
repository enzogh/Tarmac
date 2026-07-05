import { Injectable } from '@nestjs/common';
import { NodeStatus, Prisma } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { getControlPlaneVersion } from '../common/build-info';
import { PrismaService } from '../prisma/prisma.service';
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
  node?: { name: string } | null;
};

@Injectable()
export class NodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  list() {
    return this.prisma.node.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async create(dto: CreateNodeDto, actorUserId?: string) {
    const created = await this.prisma.node.create({
      data: {
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

    await this.auditLogsService.log({
      actorUserId,
      action: 'node.delete',
      resourceType: 'node',
      resourceId: deleted.id,
    });

    return deleted;
  }

  async activity(range: string) {
    const now = Date.now();
    const ranges: Record<string, number> = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
    };
    const ms = ranges[range] ?? ranges['1h'];

    const [nodes, latestSamples, disks] = (await Promise.all([
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
    ])) as [ActivityNode[], ActivitySample[], ActivityDisk[]];

    const sampleByNode = new Map(latestSamples.map((sample) => [sample.nodeId, sample]));
    const disksByNode = new Map<string, Array<(typeof disks)[number]>>();

    for (const disk of disks) {
      const list = disksByNode.get(disk.nodeId) ?? [];
      list.push(disk);
      disksByNode.set(disk.nodeId, list);
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
        agentVersion: node.agentVersion,
        agentVersionAt: node.agentVersionAt?.toISOString() ?? null,
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
          disks: nodeDisks.map((disk) => ({
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
          })),
        },
      };
    });
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
