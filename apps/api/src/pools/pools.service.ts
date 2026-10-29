import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PoolMemberStatus, Prisma } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { scopeWhere, WorkspaceScope } from '../auth/workspace.guard';
import { assertNodesInWorkspace } from '../common/workspace-ownership';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePoolDto } from './dto/create-pool.dto';
import { UpdatePoolDto } from './dto/update-pool.dto';
import { UpsertPoolMemberDto } from './dto/upsert-pool-member.dto';

@Injectable()
export class PoolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  list(scope: WorkspaceScope) {
    return this.prisma.pool.findMany({
      where: scopeWhere(scope),
      orderBy: { createdAt: 'desc' },
      include: { members: { include: { node: true }, orderBy: { createdAt: 'asc' } } },
    });
  }

  private async assertOwned(id: string, scope: WorkspaceScope) {
    const pool = await this.prisma.pool.findFirst({ where: { id, workspaceId: scope.workspaceId }, select: { id: true } });
    if (!pool) throw new NotFoundException('pool not found');
  }

  // A duplicate name in the same workspace is a user mistake, not a 500.
  private async withNameCheck<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Un pool porte déjà ce nom dans ce workspace.');
      }
      throw error;
    }
  }

  async create(dto: CreatePoolDto, scope: WorkspaceScope, actorUserId?: string) {
    const created = await this.withNameCheck(() => this.prisma.pool.create({ data: { ...dto, workspaceId: scope.workspaceId as string } }));
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'pool.create',
      resourceType: 'pool',
      resourceId: created.id,
      details: dto as unknown as Prisma.InputJsonValue,
    });
    return created;
  }

  async update(id: string, dto: UpdatePoolDto, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertOwned(id, scope);
    const updated = await this.withNameCheck(() => this.prisma.pool.update({ where: { id }, data: dto }));
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'pool.update',
      resourceType: 'pool',
      resourceId: id,
      details: dto as unknown as Prisma.InputJsonValue,
    });
    return updated;
  }

  async delete(id: string, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertOwned(id, scope);
    const deleted = await this.prisma.pool.delete({ where: { id } });
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'pool.delete',
      resourceType: 'pool',
      resourceId: id,
    });
    return deleted;
  }

  async upsertMember(poolId: string, dto: UpsertPoolMemberDto, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertOwned(poolId, scope);
    await assertNodesInWorkspace(this.prisma, scope, dto.nodeId);
    const member = await this.prisma.poolMember.upsert({
      where: { poolId_nodeId: { poolId, nodeId: dto.nodeId } },
      update: { role: dto.role, status: dto.status },
      create: { poolId, nodeId: dto.nodeId, role: dto.role, status: dto.status },
      include: { node: true, pool: true },
    });
    await this.recomputePoolStatus(poolId);
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'pool.member.upsert',
      resourceType: 'pool_member',
      resourceId: member.id,
      details: { poolId, ...dto },
    });
    return member;
  }

  async removeMember(poolId: string, nodeId: string, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertOwned(poolId, scope);
    const deleted = await this.prisma.poolMember.delete({ where: { poolId_nodeId: { poolId, nodeId } } });
    await this.recomputePoolStatus(poolId);
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'pool.member.delete',
      resourceType: 'pool_member',
      resourceId: deleted.id,
      details: { poolId, nodeId },
    });
    return deleted;
  }

  findPendingMembers() {
    return this.prisma.poolMember.findMany({
      where: { status: 'pending' },
      include: { pool: true, node: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async setMemberStatus(poolId: string, nodeId: string, status: PoolMemberStatus) {
    const member = await this.prisma.poolMember.update({
      where: { poolId_nodeId: { poolId, nodeId } },
      data: { status },
      include: { pool: true },
    });
    await this.recomputePoolStatus(poolId);
    return member;
  }

  private async recomputePoolStatus(poolId: string) {
    const members = await this.prisma.poolMember.findMany({ where: { poolId } });
    if (members.length === 0) {
      await this.prisma.pool.update({ where: { id: poolId }, data: { status: 'pending' } });
      return;
    }

    if (members.some((item) => item.status === 'error')) {
      await this.prisma.pool.update({ where: { id: poolId }, data: { status: 'error' } });
      return;
    }

    if (members.every((item) => item.status === 'active')) {
      await this.prisma.pool.update({ where: { id: poolId }, data: { status: 'active' } });
      return;
    }

    await this.prisma.pool.update({ where: { id: poolId }, data: { status: 'pending' } });
  }
}
