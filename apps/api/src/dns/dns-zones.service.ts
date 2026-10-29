import { ConflictException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DnsRecordType, DnsZoneStatus, Prisma } from '@prisma/client';
import { AgentsService } from '../agents/agents.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { scopeWhere, WorkspaceScope } from '../auth/workspace.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDnsZoneDto } from './dto/create-dns-zone.dto';
import { UpdateDnsZoneDto } from './dto/update-dns-zone.dto';
import { DnsGroupsService } from './dns-groups.service';

// DNS zones - lifecycle only; record CRUD lives in DnsRecordsService,
// delegation/DNSSEC read-only helpers live in DnsDelegationService.
export type DnsZoneSnapshot = {
  name: string;
  groupId: string;
  dnssecEnabled: boolean;
  records: Array<{
    name: string;
    type: DnsRecordType;
    ttl: number;
    isGeo: boolean;
    values: Array<{ content: string; nodeId: string | null; priority: number | null }>;
  }>;
};

@Injectable()
export class DnsZonesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    @Inject(forwardRef(() => AgentsService))
    private readonly agentsService: AgentsService,
    private readonly dnsGroupsService: DnsGroupsService,
  ) {}

  listZones(scope: WorkspaceScope, groupId?: string) {
    return this.prisma.dnsZone.findMany({
      where: { ...scopeWhere(scope), ...(groupId ? { groupId } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { records: { include: { values: { include: { node: true } } }, orderBy: { name: 'asc' } } },
    });
  }

  async assertZoneOwned(id: string, scope: WorkspaceScope) {
    const zone = await this.prisma.dnsZone.findFirst({ where: { id, workspaceId: scope.workspaceId } });
    if (!zone) throw new NotFoundException('dns zone not found');
    return zone;
  }

  async createZone(dto: CreateDnsZoneDto, scope: WorkspaceScope, actorUserId?: string) {
    await this.dnsGroupsService.assertGroupOwned(dto.groupId, scope);
    const created = await this.prisma.dnsZone.create({
      data: {
        workspaceId: scope.workspaceId as string,
        groupId: dto.groupId,
        name: dto.name,
        dnssecEnabled: dto.dnssecEnabled ?? true,
      },
    });
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'dns.zone.create',
      resourceType: 'dns_zone',
      resourceId: created.id,
      details: dto as unknown as Prisma.InputJsonValue,
    });
    return created;
  }

  // Turning DNSSEC on or off re-applies the whole zone: the primary signs
  // it or drops its keys, and secondaries follow on the next transfer.
  async updateZone(id: string, dto: UpdateDnsZoneDto, scope: WorkspaceScope, actorUserId?: string) {
    const zone = await this.assertZoneOwned(id, scope);
    if (dto.dnssecEnabled === undefined || dto.dnssecEnabled === zone.dnssecEnabled) return zone;
    const updated = await this.prisma.dnsZone.update({
      where: { id },
      data: { dnssecEnabled: dto.dnssecEnabled, status: 'pending' },
    });
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: dto.dnssecEnabled ? 'dns.zone.dnssec.enable' : 'dns.zone.dnssec.disable',
      resourceType: 'dns_zone',
      resourceId: id,
      details: { name: zone.name },
    });
    return updated;
  }

  async deleteZone(id: string, scope: WorkspaceScope, actorUserId?: string) {
    const zone = await this.assertZoneOwned(id, scope);
    // Every member (not just the primary) has a real copy of this zone in
    // its own PowerDNS - secondaries hold it as a slave zone via
    // apply_dns_zone_slave. Only telling the primary left slave zones
    // orphaned on every secondary forever (never removed, just eventually
    // expiring per the zone's own SOA).
    // Everything needed to bring the zone back from the Journal.
    const records = await this.prisma.dnsRecord.findMany({ where: { zoneId: id }, include: { values: true } });
    const snapshot = {
      name: zone.name,
      groupId: zone.groupId,
      dnssecEnabled: zone.dnssecEnabled,
      records: records.map((record) => ({
        name: record.name,
        type: record.type,
        ttl: record.ttl,
        isGeo: record.isGeo,
        values: record.values.map((value) => ({ content: value.content, nodeId: value.nodeId, priority: value.priority })),
      })),
    };
    const members = await this.prisma.dnsServerGroupMember.findMany({ where: { groupId: zone.groupId } });
    for (const member of members) {
      if (this.agentsService.isConnected(member.nodeId)) {
        this.agentsService.sendCommand(member.nodeId, {
          type: 'command.remove_dns_zone',
          payload: { zoneId: zone.id, zoneName: zone.name },
        });
      }
    }
    const deleted = await this.prisma.dnsZone.delete({ where: { id } });
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'dns.zone.delete',
      resourceType: 'dns_zone',
      resourceId: id,
      details: { name: zone.name, records: records.length },
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
    });
    return deleted;
  }

  /** Undo a zone deletion from the Journal: the zone and all its records, re-applied by the reconciliation. */
  async restoreZone(snapshot: DnsZoneSnapshot, scope: WorkspaceScope, actorUserId?: string): Promise<string> {
    const workspaceId = scope.workspaceId as string;
    if (await this.prisma.dnsZone.findFirst({ where: { workspaceId, name: snapshot.name }, select: { id: true } })) {
      throw new ConflictException(`Une zone « ${snapshot.name} » existe déjà : supprimez-la d’abord pour restaurer l’ancienne.`);
    }
    await this.dnsGroupsService.assertGroupOwned(snapshot.groupId, scope);
    const nodeIds = new Set((await this.prisma.node.findMany({ where: { workspaceId }, select: { id: true } })).map((node) => node.id));
    const zone = await this.prisma.$transaction(async (tx) => {
      const created = await tx.dnsZone.create({ data: { workspaceId, groupId: snapshot.groupId, name: snapshot.name, dnssecEnabled: snapshot.dnssecEnabled } });
      for (const record of snapshot.records) {
        await tx.dnsRecord.create({
          data: {
            zoneId: created.id,
            name: record.name,
            type: record.type,
            ttl: record.ttl,
            isGeo: record.isGeo,
            status: 'pending',
            values: {
              create: record.values.map((value) => ({
                content: value.content,
                nodeId: value.nodeId && nodeIds.has(value.nodeId) ? value.nodeId : null,
                priority: value.priority,
              })),
            },
          },
        });
      }
      return created;
    });
    await this.auditLogsService.log({
      workspaceId,
      actorUserId,
      action: 'dns.zone.restore',
      resourceType: 'dns_zone',
      resourceId: zone.id,
      details: { name: zone.name, records: snapshot.records.length },
    });
    return snapshot.name;
  }

  markZonePending(zoneId: string) {
    return this.prisma.dnsZone.update({ where: { id: zoneId }, data: { status: 'pending' } });
  }

  // Forces a zone that's already "active" back to "pending" so the next
  // reconcile tick resends the full apply_dns_zone snapshot - e.g. after an
  // agent-side bug fix that only takes effect on the next apply, with no
  // record actually changing to trigger one on its own.
  async reapplyZone(id: string, scope: WorkspaceScope, actorUserId?: string) {
    const zone = await this.assertZoneOwned(id, scope);
    const updated = await this.markZonePending(id);
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'dns.zone.reapply',
      resourceType: 'dns_zone',
      resourceId: id,
      details: { name: zone.name },
    });
    return updated;
  }

  // Whole-zone snapshot push (like apply_overlay's full peer-list push) -
  // any change to a zone's records marks the whole zone pending again, and
  // the reconcile tick re-applies the complete record set, not a diff.
  // Includes every group member (not just primary) - the agent needs the
  // full list to build the zone's own NS records (ns1.<zone>, ns2.<zone>,
  // ...), same ordering as getDelegation so the two stay consistent.
  findPendingZones() {
    return this.prisma.dnsZone.findMany({
      where: { status: 'pending' },
      include: {
        records: { include: { values: true } },
        group: { include: { members: { include: { node: true }, orderBy: [{ role: 'asc' }, { createdAt: 'asc' }] } } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async setZoneStatus(zoneId: string, status: DnsZoneStatus) {
    const zone = await this.prisma.dnsZone.update({ where: { id: zoneId }, data: { status } });
    if (status !== 'pending') {
      await this.prisma.dnsRecord.updateMany({ where: { zoneId }, data: { status } });
    }
    return zone;
  }
}
