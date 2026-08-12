import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ShareClientAccess, ShareStatus } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { scopeWhere, WorkspaceScope } from '../auth/workspace.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShareDto } from './dto/create-share.dto';
import { UpdateShareDto } from './dto/update-share.dto';

@Injectable()
export class SharesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  list(scope: WorkspaceScope) {
    return this.prisma.share.findMany({
      where: scopeWhere(scope),
      orderBy: { createdAt: 'desc' },
      include: { node: true, clients: true },
    });
  }

  private async assertOwned(id: string, scope: WorkspaceScope) {
    const share = await this.prisma.share.findFirst({ where: { id, workspaceId: scope.workspaceId }, select: { id: true } });
    if (!share) throw new NotFoundException('share not found');
  }

  async create(dto: CreateShareDto, scope: WorkspaceScope, actorUserId?: string) {
    const data: Prisma.ShareCreateInput = {
      workspace: { connect: { id: scope.workspaceId } },
      name: dto.name,
      path: dto.path,
      ...(dto.nodeId ? { node: { connect: { id: dto.nodeId } } } : {}),
    };

    const created = await this.prisma.share.create({ data, include: { clients: true } });
    await this.auditLogsService.log({
      actorUserId,
      action: 'share.create',
      resourceType: 'share',
      resourceId: created.id,
      details: { name: created.name, path: created.path },
    });
    return created;
  }

  async update(id: string, dto: UpdateShareDto, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertOwned(id, scope);
    const data: Prisma.ShareUpdateInput = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.path !== undefined ? { path: dto.path } : {}),
      ...(dto.status !== undefined ? { status: dto.status as ShareStatus } : {}),
      ...(dto.nodeId !== undefined ? { node: { connect: { id: dto.nodeId } } } : {}),
    };

    const updated = await this.prisma.share.update({ where: { id }, data, include: { clients: true } });
    await this.auditLogsService.log({
      actorUserId,
      action: 'share.update',
      resourceType: 'share',
      resourceId: updated.id,
      details: dto as unknown as Prisma.InputJsonValue,
    });
    return updated;
  }

  async delete(id: string, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertOwned(id, scope);
    const deleted = await this.prisma.share.delete({ where: { id } });
    await this.auditLogsService.log({
      actorUserId,
      action: 'share.delete',
      resourceType: 'share',
      resourceId: deleted.id,
    });
    return deleted;
  }

  async listClients(shareId: string, scope: WorkspaceScope) {
    await this.assertOwned(shareId, scope);
    return this.prisma.shareClient.findMany({ where: { shareId }, orderBy: { createdAt: 'desc' } });
  }

  async upsertClient(shareId: string, clientId: string, access: ShareClientAccess, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertOwned(shareId, scope);
    const item = await this.prisma.shareClient.upsert({
      where: { shareId_clientId: { shareId, clientId } },
      update: { access },
      create: { shareId, clientId, access },
    });

    await this.auditLogsService.log({
      actorUserId,
      action: 'share.client.upsert',
      resourceType: 'share_client',
      resourceId: item.id,
      details: { shareId, clientId, access },
    });

    return item;
  }

  async removeClient(shareId: string, clientId: string, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertOwned(shareId, scope);
    const item = await this.prisma.shareClient.delete({
      where: { shareId_clientId: { shareId, clientId } },
    });

    await this.auditLogsService.log({
      actorUserId,
      action: 'share.client.delete',
      resourceType: 'share_client',
      resourceId: item.id,
      details: { shareId, clientId },
    });

    return item;
  }

  findPending() {
    return this.prisma.share.findMany({ where: { status: 'pending' } });
  }

  setStatus(id: string, status: 'pending' | 'active' | 'error') {
    return this.prisma.share.update({ where: { id }, data: { status } });
  }

  async reapply(id: string, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertOwned(id, scope);
    const updated = await this.prisma.share.update({
      where: { id },
      data: { status: 'pending' },
      include: { node: true },
    });

    await this.auditLogsService.log({
      actorUserId,
      action: 'share.reapply',
      resourceType: 'share',
      resourceId: updated.id,
      details: { nodeId: updated.nodeId },
    });

    return updated;
  }
}
