import { Injectable } from '@nestjs/common';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { WorkspaceScope } from '../auth/workspace.guard';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertDnsRecordDto } from './dto/upsert-dns-record.dto';
import { DnsZonesService } from './dns-zones.service';

@Injectable()
export class DnsRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly dnsZonesService: DnsZonesService,
  ) {}

  async upsertRecord(zoneId: string, dto: UpsertDnsRecordDto, scope: WorkspaceScope, actorUserId?: string) {
    await this.dnsZonesService.assertZoneOwned(zoneId, scope);
    const ttl = dto.ttl ?? 3600;
    const isGeo = dto.isGeo ?? false;

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
          nodeId: value.nodeId ?? null,
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
    });
    return this.prisma.dnsRecord.findUnique({ where: { id: recordId }, include: { values: true } });
  }

  async deleteRecord(zoneId: string, recordId: string, scope: WorkspaceScope, actorUserId?: string) {
    await this.dnsZonesService.assertZoneOwned(zoneId, scope);
    const deleted = await this.prisma.dnsRecord.delete({ where: { id: recordId } });
    await this.dnsZonesService.markZonePending(zoneId);
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'dns.record.delete',
      resourceType: 'dns_record',
      resourceId: deleted.id,
      details: { zoneId },
    });
    return deleted;
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
