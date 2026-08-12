import { ConflictException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DnsServerGroupMemberStatus, DnsZoneStatus, Prisma } from '@prisma/client';
import { AgentsService } from '../agents/agents.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { scopeWhere, WorkspaceScope } from '../auth/workspace.guard';
import { extractExternalIp } from '../nodes/extract-external-ip';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDnsGroupDto } from './dto/create-dns-group.dto';
import { CreateDnsZoneDto } from './dto/create-dns-zone.dto';
import { UpdateDnsGroupDto } from './dto/update-dns-group.dto';
import { UpsertDnsGroupMemberDto } from './dto/upsert-dns-group-member.dto';
import { UpsertDnsRecordDto } from './dto/upsert-dns-record.dto';

@Injectable()
export class DnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    @Inject(forwardRef(() => AgentsService))
    private readonly agentsService: AgentsService,
  ) {}

  // ---------------------------------------------------------------------
  // DNS server groups (primary/secondary fleet, mirrors PoolsService)
  // ---------------------------------------------------------------------

  listGroups(scope: WorkspaceScope) {
    return this.prisma.dnsServerGroup.findMany({
      where: scopeWhere(scope),
      orderBy: { createdAt: 'desc' },
      include: {
        members: { include: { node: true }, orderBy: { createdAt: 'asc' } },
        zones: { select: { id: true, name: true, status: true } },
      },
    });
  }

  private async assertGroupOwned(id: string, scope: WorkspaceScope) {
    const group = await this.prisma.dnsServerGroup.findFirst({
      where: { id, workspaceId: scope.workspaceId },
      select: { id: true },
    });
    if (!group) throw new NotFoundException('dns server group not found');
  }

  async createGroup(dto: CreateDnsGroupDto, scope: WorkspaceScope, actorUserId?: string) {
    const created = await this.prisma.dnsServerGroup.create({
      data: { name: dto.name, workspaceId: scope.workspaceId as string },
    });
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'dns.group.create',
      resourceType: 'dns_server_group',
      resourceId: created.id,
      details: dto as unknown as Prisma.InputJsonValue,
    });
    return created;
  }

  async updateGroup(id: string, dto: UpdateDnsGroupDto, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertGroupOwned(id, scope);
    const updated = await this.prisma.dnsServerGroup.update({ where: { id }, data: dto });
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'dns.group.update',
      resourceType: 'dns_server_group',
      resourceId: id,
      details: dto as unknown as Prisma.InputJsonValue,
    });
    return updated;
  }

  async deleteGroup(id: string, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertGroupOwned(id, scope);
    const zoneCount = await this.prisma.dnsZone.count({ where: { groupId: id } });
    if (zoneCount > 0) {
      throw new ConflictException('remove every zone from this group before deleting it');
    }
    const deleted = await this.prisma.dnsServerGroup.delete({ where: { id } });
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'dns.group.delete',
      resourceType: 'dns_server_group',
      resourceId: id,
    });
    return deleted;
  }

  async upsertGroupMember(groupId: string, dto: UpsertDnsGroupMemberDto, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertGroupOwned(groupId, scope);
    const member = await this.prisma.dnsServerGroupMember.upsert({
      where: { groupId_nodeId: { groupId, nodeId: dto.nodeId } },
      update: { role: dto.role, status: dto.status, conflictDetail: Prisma.JsonNull },
      create: { groupId, nodeId: dto.nodeId, role: dto.role, status: dto.status },
      include: { node: true, group: true },
    });
    await this.recomputeGroupStatus(groupId);
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'dns.group_member.upsert',
      resourceType: 'dns_server_group_member',
      resourceId: member.id,
      details: { groupId, ...dto },
    });
    return member;
  }

  async removeGroupMember(groupId: string, nodeId: string, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertGroupOwned(groupId, scope);
    const deleted = await this.prisma.dnsServerGroupMember.delete({ where: { groupId_nodeId: { groupId, nodeId } } });
    await this.recomputeGroupStatus(groupId);
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'dns.group_member.delete',
      resourceType: 'dns_server_group_member',
      resourceId: deleted.id,
      details: { groupId, nodeId },
    });
    return deleted;
  }

  // Sent when the user picks "kill the process and retry" on a port-conflict
  // banner. Marks the member pending immediately (optimistic - clears the
  // conflict from the UI right away) and lets the agent's command result
  // set it back to error via setGroupMemberStatus if the retry also fails.
  async resolvePortConflict(groupId: string, nodeId: string, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertGroupOwned(groupId, scope);
    const member = await this.prisma.dnsServerGroupMember.findUnique({
      where: { groupId_nodeId: { groupId, nodeId } },
    });
    if (!member) throw new NotFoundException('dns server group member not found');

    const sent = this.agentsService.sendCommand(nodeId, {
      type: 'command.dns_resolve_port_conflict',
      payload: { groupId, nodeId, action: 'kill_and_retry' },
    });
    if (!sent) throw new NotFoundException('node is offline');

    const updated = await this.prisma.dnsServerGroupMember.update({
      where: { groupId_nodeId: { groupId, nodeId } },
      data: { status: 'pending', conflictDetail: Prisma.JsonNull },
    });
    await this.recomputeGroupStatus(groupId);
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'dns.group_member.resolve_port_conflict',
      resourceType: 'dns_server_group_member',
      resourceId: updated.id,
      details: { groupId, nodeId },
    });
    return updated;
  }

  findPendingGroupMembers() {
    return this.prisma.dnsServerGroupMember.findMany({
      where: { status: 'pending' },
      include: { group: { include: { members: { include: { node: true } } } }, node: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async setGroupMemberStatus(
    groupId: string,
    nodeId: string,
    status: DnsServerGroupMemberStatus,
    conflictDetail: Prisma.InputJsonValue | null = null,
  ) {
    const member = await this.prisma.dnsServerGroupMember.update({
      where: { groupId_nodeId: { groupId, nodeId } },
      data: { status, conflictDetail: conflictDetail ?? Prisma.JsonNull },
      include: { group: true },
    });
    await this.recomputeGroupStatus(groupId);
    return member;
  }

  private async recomputeGroupStatus(groupId: string) {
    const members = await this.prisma.dnsServerGroupMember.findMany({ where: { groupId } });
    if (members.length === 0) {
      await this.prisma.dnsServerGroup.update({ where: { id: groupId }, data: { status: 'pending' } });
      return;
    }

    if (members.some((item) => item.status === 'error')) {
      await this.prisma.dnsServerGroup.update({ where: { id: groupId }, data: { status: 'error' } });
      return;
    }

    if (members.every((item) => item.status === 'active')) {
      await this.prisma.dnsServerGroup.update({ where: { id: groupId }, data: { status: 'active' } });
      return;
    }

    await this.prisma.dnsServerGroup.update({ where: { id: groupId }, data: { status: 'pending' } });
  }

  // Called from AgentsService.onCommandResult when the primary member's
  // apply_dns_server_group result echoes back the TSIG key it generated -
  // relayed to secondary members on their next reconcile tick.
  setGroupTsigKeySecret(groupId: string, tsigKeySecret: string) {
    return this.prisma.dnsServerGroup.update({ where: { id: groupId }, data: { tsigKeySecret } });
  }

  private getPrimaryMember(groupId: string) {
    return this.prisma.dnsServerGroupMember.findFirst({
      where: { groupId, role: 'primary' },
      include: { node: true },
    });
  }

  // ---------------------------------------------------------------------
  // Zones + records
  // ---------------------------------------------------------------------

  listZones(scope: WorkspaceScope, groupId?: string) {
    return this.prisma.dnsZone.findMany({
      where: { ...scopeWhere(scope), ...(groupId ? { groupId } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { records: { include: { values: { include: { node: true } } }, orderBy: { name: 'asc' } } },
    });
  }

  private async assertZoneOwned(id: string, scope: WorkspaceScope) {
    const zone = await this.prisma.dnsZone.findFirst({ where: { id, workspaceId: scope.workspaceId } });
    if (!zone) throw new NotFoundException('dns zone not found');
    return zone;
  }

  async createZone(dto: CreateDnsZoneDto, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertGroupOwned(dto.groupId, scope);
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
    const primary = await this.getPrimaryMember(zone.groupId);
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

  private markZonePending(zoneId: string) {
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
  findPendingZones() {
    return this.prisma.dnsZone.findMany({
      where: { status: 'pending' },
      include: {
        records: { include: { values: true } },
        group: { include: { members: { where: { role: 'primary' }, include: { node: true } } } },
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

  async upsertRecord(zoneId: string, dto: UpsertDnsRecordDto, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertZoneOwned(zoneId, scope);
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

    await this.markZonePending(zoneId);
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
    await this.assertZoneOwned(zoneId, scope);
    const deleted = await this.prisma.dnsRecord.delete({ where: { id: recordId } });
    await this.markZonePending(zoneId);
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

  // Vanity in-zone nameservers (ns1.<zone>, ns2.<zone>, ...) pointing at each
  // group member's public IP. Most registrars additionally require "glue
  // records" to be registered separately for in-domain nameservers - that
  // step is registrar-specific and stays manual, the UI just explains it.
  async getDelegation(id: string, scope: WorkspaceScope) {
    const zone = await this.assertZoneOwned(id, scope);
    const members = await this.prisma.dnsServerGroupMember.findMany({
      where: { groupId: zone.groupId },
      include: { node: true },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });

    const glue = members
      .map((member, index) => ({ host: `ns${index + 1}.${zone.name}`, ip: extractExternalIp(member.node.overlayEndpoint) }))
      .filter((entry): entry is { host: string; ip: string } => Boolean(entry.ip));

    return { nsHostnames: glue.map((entry) => entry.host), glue };
  }

  // DS/DNSKEY are never persisted (see plan) - always fetched live from the
  // primary's PowerDNS instance over the same request/response WS channel
  // used for requestTraceroute.
  async getDnssecKeys(id: string, scope: WorkspaceScope) {
    const zone = await this.assertZoneOwned(id, scope);
    if (!zone.dnssecEnabled) {
      return { dsRecords: [], dnskeyRecords: [] };
    }
    const primary = await this.getPrimaryMember(zone.groupId);
    if (!primary) throw new NotFoundException("this zone's group has no primary server yet");
    return this.agentsService.requestDnsZoneKeys(primary.nodeId, zone.name);
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
