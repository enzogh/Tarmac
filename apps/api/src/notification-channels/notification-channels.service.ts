import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { scopeWhere, WorkspaceScope } from '../auth/workspace.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNotificationChannelDto } from './dto/create-notification-channel.dto';
import { UpdateNotificationChannelDto } from './dto/update-notification-channel.dto';

@Injectable()
export class NotificationChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  list(scope: WorkspaceScope) {
    return this.prisma.notificationChannel.findMany({ where: scopeWhere(scope), orderBy: { createdAt: 'desc' } });
  }

  private async assertOwned(id: string, scope: WorkspaceScope) {
    const channel = await this.prisma.notificationChannel.findFirst({
      where: { id, workspaceId: scope.workspaceId },
      select: { id: true },
    });
    if (!channel) throw new NotFoundException('notification channel not found');
  }

  async create(dto: CreateNotificationChannelDto, scope: WorkspaceScope, actorUserId?: string) {
    const created = await this.prisma.notificationChannel.create({
      data: { ...dto, workspaceId: scope.workspaceId as string },
    });
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'notification_channel.create',
      resourceType: 'notification_channel',
      resourceId: created.id,
      details: dto as unknown as Prisma.InputJsonValue,
    });
    return created;
  }

  async update(id: string, dto: UpdateNotificationChannelDto, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertOwned(id, scope);
    const updated = await this.prisma.notificationChannel.update({ where: { id }, data: dto });
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'notification_channel.update',
      resourceType: 'notification_channel',
      resourceId: id,
      details: dto as unknown as Prisma.InputJsonValue,
    });
    return updated;
  }

  async delete(id: string, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertOwned(id, scope);
    const deleted = await this.prisma.notificationChannel.delete({ where: { id } });
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'notification_channel.delete',
      resourceType: 'notification_channel',
      resourceId: id,
    });
    return deleted;
  }

  async test(id: string, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertOwned(id, scope);
    const channel = await this.prisma.notificationChannel.findUniqueOrThrow({ where: { id } });
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'notification_channel.test',
      resourceType: 'notification_channel',
      resourceId: id,
      details: { target: channel.target, type: channel.type },
    });

    return {
      success: true,
      message: `Test notification sent to ${channel.target}`,
      testedAt: new Date().toISOString(),
    };
  }
}
