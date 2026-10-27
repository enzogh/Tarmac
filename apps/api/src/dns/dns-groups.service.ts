import { BadRequestException, ConflictException, forwardRef, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DnsServerGroupMemberStatus, Prisma } from '@prisma/client';
import { AgentsService } from '../agents/agents.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { scopeWhere, WorkspaceScope } from '../auth/workspace.guard';
import { sealSecret } from '../common/secret-box';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDnsGroupDto } from './dto/create-dns-group.dto';
import { UpdateDnsGroupDto } from './dto/update-dns-group.dto';
import { UpsertDnsGroupMemberDto } from './dto/upsert-dns-group-member.dto';

// 1 primary + up to 3 secondaries - matches what a single AXFR-fanout from
// one primary can reasonably serve without dedicated tuning.
const MAX_GROUP_MEMBERS = 4;

// DNS server groups (primary/secondary fleet, mirrors PoolsService).
@Injectable()
export class DnsGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    @Inject(forwardRef(() => AgentsService))
    private readonly agentsService: AgentsService,
  ) {}

  listGroups(scope: WorkspaceScope) {
    return this.prisma.dnsServerGroup.findMany({
      where: scopeWhere(scope),
      orderBy: { createdAt: 'desc' },
      include: {
        members: { include: { node: true }, orderBy: { createdAt: 'asc' } },
        zones: { select: { id: true, name: true, status: true, syncCheckedAt: true, syncDetail: true } },
      },
    });
  }

  async assertGroupOwned(id: string, scope: WorkspaceScope) {
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
    const members = await this.prisma.dnsServerGroupMember.findMany({ where: { groupId: id } });
    const cleanupSent = members.every((member) => this.sendUninstallDnsNode(member.nodeId));
    const deleted = await this.prisma.dnsServerGroup.delete({ where: { id } });
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'dns.group.delete',
      resourceType: 'dns_server_group',
      resourceId: id,
    });
    return { ...deleted, cleanupSent };
  }

  // Tells a node to stop PowerDNS and remove every zone it's currently
  // serving - fire-and-forget by design (returns whether the command was
  // even sent, not whether it succeeded). A node being removed from a group
  // is very often already offline (that's frequently *why* it's being
  // removed), so this must never block the removal itself; the caller
  // surfaces `cleanupSent` to the frontend instead so the user knows to
  // clean up manually if the node is still alive somewhere.
  private sendUninstallDnsNode(nodeId: string): boolean {
    return this.agentsService.sendCommand(nodeId, { type: 'command.uninstall_dns_node', payload: {} });
  }

  async upsertGroupMember(groupId: string, dto: UpsertDnsGroupMemberDto, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertGroupOwned(groupId, scope);
    const existing = await this.prisma.dnsServerGroupMember.findUnique({
      where: { groupId_nodeId: { groupId, nodeId: dto.nodeId } },
      select: { id: true },
    });
    if (!existing) {
      const memberCount = await this.prisma.dnsServerGroupMember.count({ where: { groupId } });
      if (memberCount >= MAX_GROUP_MEMBERS) {
        throw new BadRequestException(`a DNS server group can have at most ${MAX_GROUP_MEMBERS} members`);
      }
    }
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
    const cleanupSent = this.sendUninstallDnsNode(nodeId);
    const deleted = await this.prisma.dnsServerGroupMember.delete({ where: { groupId_nodeId: { groupId, nodeId } } });
    await this.recomputeGroupStatus(groupId);
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'dns.group_member.delete',
      resourceType: 'dns_server_group_member',
      resourceId: deleted.id,
      details: { groupId, nodeId, cleanupSent },
    });
    return { ...deleted, cleanupSent };
  }

  // The member's PowerDNS maintenance, from the UI: the upgrade to the
  // release the agent targets (one server at a time, when the user
  // chooses), or a retry of a task the agent gave up on. Marks the task
  // requested right away, so the UI shows it before the next heartbeat.
  async runMemberMaintenance(groupId: string, nodeId: string, upgrade: boolean, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertGroupOwned(groupId, scope);
    const member = await this.prisma.dnsServerGroupMember.findUnique({
      where: { groupId_nodeId: { groupId, nodeId } },
      include: { node: { select: { dnsServerState: true } } },
    });
    if (!member) throw new NotFoundException('dns server group member not found');
    if (!this.agentsService.requestDnsMaintenance(nodeId, upgrade)) throw new NotFoundException('node is offline');

    const state = (member.node.dnsServerState as { tasks?: Record<string, unknown> } | null) ?? null;
    if (state && upgrade) {
      const tasks = { ...(state.tasks ?? {}), upgrade: { status: 'requested', attempts: 0, error: null, updatedAt: new Date().toISOString() } };
      await this.prisma.node.update({ where: { id: nodeId }, data: { dnsServerState: { ...state, tasks } as Prisma.InputJsonObject } });
    }
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: upgrade ? 'dns.group_member.upgrade_pdns' : 'dns.group_member.retry_maintenance',
      resourceType: 'dns_server_group_member',
      resourceId: member.id,
      details: { groupId, nodeId },
    });
    return { sent: true };
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
    return this.prisma.dnsServerGroup.update({ where: { id: groupId }, data: { tsigKeySecret: sealSecret(tsigKeySecret) } });
  }

  getPrimaryMember(groupId: string) {
    return this.prisma.dnsServerGroupMember.findFirst({
      where: { groupId, role: 'primary' },
      include: { node: true },
    });
  }
}
