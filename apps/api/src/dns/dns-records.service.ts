import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { WorkspaceScope } from '../auth/workspace.guard';
import { extractExternalIp } from '../nodes/extract-external-ip';
import { assertNodesInWorkspace } from '../common/workspace-ownership';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertDnsRecordDto } from './dto/upsert-dns-record.dto';
import { DnsZonesService } from './dns-zones.service';

export type DnsRecordSnapshot = {
  zoneId: string;
  name: string;
  type: UpsertDnsRecordDto['type'];
  absent?: boolean;
  ttl?: number;
  isGeo?: boolean;
  values?: Array<{ content: string; nodeId: string | null; priority: number | null }>;
};

@Injectable()
export class DnsRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly dnsZonesService: DnsZonesService,
  ) {}

  async upsertRecord(zoneId: string, dto: UpsertDnsRecordDto, scope: WorkspaceScope, actorUserId?: string) {
    await this.dnsZonesService.assertZoneOwned(zoneId, scope);
    await assertNodesInWorkspace(this.prisma, scope, ...dto.values.map((value) => value.nodeId));
    const ttl = dto.ttl ?? 3600;
    const isGeo = dto.isGeo ?? false;

    // The value editor is free-text only (no node picker) - a value's
    // content is matched against the workspace's own fleet IPs here so the
    // reverse lookup (GET nodes/:nodeId/records, consumed by the infra page
    // and GeoMapSection) keeps working without exposing that plumbing in the UI.
    const nodesByIp = new Map(
      (
        await this.prisma.node.findMany({
          where: { workspaceId: scope.workspaceId as string },
          select: { id: true, overlayEndpoint: true },
        })
      )
        .map((node) => [extractExternalIp(node.overlayEndpoint), node.id] as const)
        .filter((entry): entry is [string, string] => entry[0] !== null),
    );

    // "Before" state, so the change can be undone from the Journal.
    const before = await this.recordSnapshot(zoneId, dto.name, dto.type);

    const recordId = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.dnsRecord.findUnique({
        where: { zoneId_name_type: { zoneId, name: dto.name, type: dto.type } },
        select: { id: true },
      });

      const saved = existing
        ? await tx.dnsRecord.update({ where: { id: existing.id }, data: { ttl, isGeo, status: 'pending' } })
        : await tx.dnsRecord.create({ data: { zoneId, name: dto.name, type: dto.type, ttl, isGeo, status: 'pending' } });

      await tx.dnsRecordValue.deleteMany({ where: { recordId: saved.id } });
      await tx.dnsRecordValue.createMany({
        data: dto.values.map((value) => ({
          recordId: saved.id,
          content: value.content,
          nodeId: value.nodeId ?? nodesByIp.get(value.content) ?? null,
          priority: value.priority ?? null,
        })),
      });

      return saved.id;
    });

    await this.dnsZonesService.markZonePending(zoneId);
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'dns.record.upsert',
      resourceType: 'dns_record',
      resourceId: recordId,
      details: { zoneId, name: dto.name, type: dto.type },
      snapshot: before as unknown as Prisma.InputJsonValue,
    });
    return this.prisma.dnsRecord.findUnique({ where: { id: recordId }, include: { values: true } });
  }

  async deleteRecord(zoneId: string, recordId: string, scope: WorkspaceScope, actorUserId?: string) {
    await this.dnsZonesService.assertZoneOwned(zoneId, scope);
    // The record must belong to this (owned) zone: a record id from another
    // zone - or another workspace - is not found here.
    const record = await this.prisma.dnsRecord.findFirst({ where: { id: recordId, zoneId }, select: { name: true, type: true } });
    if (!record) throw new NotFoundException('dns record not found');
    const before = await this.recordSnapshot(zoneId, record.name, record.type);
    const deleted = await this.prisma.dnsRecord.delete({ where: { id: recordId } });
    await this.dnsZonesService.markZonePending(zoneId);
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'dns.record.delete',
      resourceType: 'dns_record',
      resourceId: deleted.id,
      details: { zoneId, name: record.name, type: record.type },
      snapshot: before as unknown as Prisma.InputJsonValue,
    });
    return deleted;
  }

  /** A record (name + type) as it is now, or `absent` when there is none. */
  private async recordSnapshot(zoneId: string, name: string, type: UpsertDnsRecordDto['type']): Promise<DnsRecordSnapshot> {
    const record = await this.prisma.dnsRecord.findUnique({ where: { zoneId_name_type: { zoneId, name, type } }, include: { values: true } });
    if (!record) return { zoneId, name, type, absent: true };
    return {
      zoneId,
      name,
      type,
      ttl: record.ttl,
      isGeo: record.isGeo,
      values: record.values.map((value) => ({ content: value.content, nodeId: value.nodeId, priority: value.priority })),
    };
  }

  /** Undo from the Journal: put a record back as it was (or remove it if it didn't exist). */
  async restoreRecord(snapshot: DnsRecordSnapshot, scope: WorkspaceScope, actorUserId?: string): Promise<string> {
    const zone = await this.prisma.dnsZone.findFirst({ where: { id: snapshot.zoneId, workspaceId: scope.workspaceId } });
    if (!zone) throw new NotFoundException('La zone de cet enregistrement n’existe plus : restaurez d’abord la zone.');
    const label = `${snapshot.name === '@' ? zone.name : `${snapshot.name}.${zone.name}`} (${snapshot.type})`;
    if (snapshot.absent) {
      const current = await this.prisma.dnsRecord.findUnique({ where: { zoneId_name_type: { zoneId: zone.id, name: snapshot.name, type: snapshot.type } } });
      if (current) await this.deleteRecord(zone.id, current.id, scope, actorUserId);
      return label;
    }
    await this.upsertRecord(
      zone.id,
      {
        name: snapshot.name,
        type: snapshot.type,
        ttl: snapshot.ttl,
        isGeo: snapshot.isGeo,
        values: (snapshot.values ?? []).map((value) => ({ content: value.content, nodeId: value.nodeId ?? undefined, priority: value.priority ?? undefined })),
      },
      scope,
      actorUserId,
    );
    return label;
  }

  async recordsForNode(nodeId: string, scope: WorkspaceScope) {
    const values = await this.prisma.dnsRecordValue.findMany({
      where: { nodeId, record: { zone: { workspaceId: scope.workspaceId } } },
      include: { record: { include: { zone: true } } },
    });
    return values.map((value) => ({
      zoneId: value.record.zone.id,
      zoneName: value.record.zone.name,
      recordId: value.record.id,
      recordName: value.record.name,
      type: value.record.type,
      isGeo: value.record.isGeo,
    }));
  }
}
