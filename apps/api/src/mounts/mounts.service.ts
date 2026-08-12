import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { MountStatus, Prisma } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AgentsService } from '../agents/agents.service';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_WORKSPACE_ID } from '../workspaces/default-workspace';
import { CreateMountDto } from './dto/create-mount.dto';
import { UpdateMountDto } from './dto/update-mount.dto';

@Injectable()
export class MountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    @Inject(forwardRef(() => AgentsService))
    private readonly agentsService: AgentsService,
  ) {}

  list() {
    return this.prisma.mount.findMany({ orderBy: { createdAt: 'desc' }, include: { node: true } });
  }

  async create(dto: CreateMountDto, actorUserId?: string) {
    const data: Prisma.MountCreateInput = {
      workspace: { connect: { id: DEFAULT_WORKSPACE_ID } },
      name: dto.name,
      sourcePath: dto.sourcePath,
      additionalSources: dto.additionalSources ?? [],
      targetPath: dto.targetPath,
      fsType: dto.fsType ?? 'nfs',
      mountOptions: dto.mountOptions,
      remoteHost: dto.remoteHost,
      remoteUser: dto.remoteUser,
      remoteSshPort: dto.remoteSshPort,
      ...(dto.nodeId ? { node: { connect: { id: dto.nodeId } } } : {}),
    };

    const created = await this.prisma.mount.create({ data });
    await this.auditLogsService.log({
      actorUserId,
      action: 'mount.create',
      resourceType: 'mount',
      resourceId: created.id,
      details: { sourcePath: created.sourcePath, targetPath: created.targetPath },
    });
    return created;
  }

  async update(id: string, dto: UpdateMountDto, actorUserId?: string) {
    const data: Prisma.MountUpdateInput = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.sourcePath !== undefined ? { sourcePath: dto.sourcePath } : {}),
      ...(dto.additionalSources !== undefined ? { additionalSources: dto.additionalSources } : {}),
      ...(dto.targetPath !== undefined ? { targetPath: dto.targetPath } : {}),
      ...(dto.fsType !== undefined ? { fsType: dto.fsType } : {}),
      ...(dto.mountOptions !== undefined ? { mountOptions: dto.mountOptions } : {}),
      ...(dto.status !== undefined ? { status: dto.status as MountStatus } : {}),
      ...(dto.nodeId !== undefined ? { node: { connect: { id: dto.nodeId } } } : {}),
      ...(dto.remoteHost !== undefined ? { remoteHost: dto.remoteHost } : {}),
      ...(dto.remoteUser !== undefined ? { remoteUser: dto.remoteUser } : {}),
      ...(dto.remoteSshPort !== undefined ? { remoteSshPort: dto.remoteSshPort } : {}),
    };

    const updated = await this.prisma.mount.update({ where: { id }, data });
    await this.auditLogsService.log({
      actorUserId,
      action: 'mount.update',
      resourceType: 'mount',
      resourceId: updated.id,
      details: dto as unknown as Prisma.InputJsonValue,
    });
    return updated;
  }

  async delete(id: string, actorUserId?: string) {
    const mount = await this.prisma.mount.findUnique({ where: { id } });
    if (!mount) {
      return this.prisma.mount.delete({ where: { id } });
    }

    let cleanupDispatched = false;
    if (mount.nodeId && this.agentsService.isConnected(mount.nodeId)) {
      this.agentsService.sendCommand(mount.nodeId, {
        type: 'command.remove_mount',
        payload: {
          mountId: mount.id,
          sourcePath: mount.sourcePath,
          targetPath: mount.targetPath,
        },
      });
      cleanupDispatched = true;
    }

    const deleted = await this.prisma.mount.delete({ where: { id } });
    await this.auditLogsService.log({
      actorUserId,
      action: 'mount.delete',
      resourceType: 'mount',
      resourceId: deleted.id,
      details: {
        sourcePath: deleted.sourcePath,
        targetPath: deleted.targetPath,
        cleanupDispatched,
      },
    });
    return deleted;
  }

  async remount(id: string, actorUserId?: string) {
    const updated = await this.prisma.mount.update({
      where: { id },
      data: { status: 'pending', lastError: null },
      include: { node: true },
    });

    await this.auditLogsService.log({
      actorUserId,
      action: 'mount.remount',
      resourceType: 'mount',
      resourceId: updated.id,
      details: { nodeId: updated.nodeId },
    });

    return updated;
  }

  findPending() {
    return this.prisma.mount.findMany({ where: { status: 'pending' } });
  }

  setStatus(id: string, status: 'pending' | 'active' | 'error', message?: string | null) {
    return this.prisma.mount.update({
      where: { id },
      data: { status, lastError: status === 'error' ? message ?? null : null },
      include: { node: true },
    });
  }
}
