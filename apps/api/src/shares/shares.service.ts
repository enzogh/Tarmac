import { Injectable } from '@nestjs/common';
import { Prisma, ShareClientAccess, ShareStatus } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_WORKSPACE_ID } from '../workspaces/default-workspace';
import { CreateShareDto } from './dto/create-share.dto';
import { UpdateShareDto } from './dto/update-share.dto';

@Injectable()
export class SharesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  list() {
    return this.prisma.share.findMany({
      orderBy: { createdAt: 'desc' },
      include: { node: true, clients: true },
    });
  }

  async create(dto: CreateShareDto, actorUserId?: string) {
    const data: Prisma.ShareCreateInput = {
      workspace: { connect: { id: DEFAULT_WORKSPACE_ID } },
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

  async update(id: string, dto: UpdateShareDto, actorUserId?: string) {
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

  async delete(id: string, actorUserId?: string) {
    const deleted = await this.prisma.share.delete({ where: { id } });
    await this.auditLogsService.log({
      actorUserId,
      action: 'share.delete',
      resourceType: 'share',
      resourceId: deleted.id,
    });
    return deleted;
  }

  listClients(shareId: string) {
    return this.prisma.shareClient.findMany({ where: { shareId }, orderBy: { createdAt: 'desc' } });
  }

  async upsertClient(shareId: string, clientId: string, access: ShareClientAccess, actorUserId?: string) {
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

  async removeClient(shareId: string, clientId: string, actorUserId?: string) {
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

  async reapply(id: string, actorUserId?: string) {
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
