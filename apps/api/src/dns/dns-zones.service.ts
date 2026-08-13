import { forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DnsZoneStatus, Prisma } from '@prisma/client';
import { AgentsService } from '../agents/agents.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { scopeWhere, WorkspaceScope } from '../auth/workspace.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDnsZoneDto } from './dto/create-dns-zone.dto';
import { DnsGroupsService } from './dns-groups.service';

// DNS zones - lifecycle only; record CRUD lives in DnsRecordsService,
// delegation/DNSSEC read-only helpers live in DnsDelegationService.
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

  async deleteZone(id: string, scope: WorkspaceScope, actorUserId?: string) {
    const zone = await this.assertZoneOwned(id, scope);
    const primary = await this.dnsGroupsService.getPrimaryMember(zone.groupId);
    if (primary && this.agentsService.isConnected(primary.nodeId)) {
      this.agentsService.sendCommand(primary.nodeId, {
        type: 'command.remove_dns_zone',
        payload: { zoneId: zone.id, zoneName: zone.name },
      });
    }
    const deleted = await this.prisma.dnsZone.delete({ where: { id } });
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'dns.zone.delete',
      resourceType: 'dns_zone',
      resourceId: id,
      details: { name: zone.name },
    });
    return deleted;
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
