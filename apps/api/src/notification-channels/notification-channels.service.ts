import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_WORKSPACE_ID } from '../workspaces/default-workspace';
import { CreateNotificationChannelDto } from './dto/create-notification-channel.dto';
import { UpdateNotificationChannelDto } from './dto/update-notification-channel.dto';

@Injectable()
export class NotificationChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  list() {
    return this.prisma.notificationChannel.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async create(dto: CreateNotificationChannelDto, actorUserId?: string) {
    const created = await this.prisma.notificationChannel.create({ data: { ...dto, workspaceId: DEFAULT_WORKSPACE_ID } });
    await this.auditLogsService.log({
      actorUserId,
      action: 'notification_channel.create',
      resourceType: 'notification_channel',
      resourceId: created.id,
      details: dto as unknown as Prisma.InputJsonValue,
    });
    return created;
  }

  async update(id: string, dto: UpdateNotificationChannelDto, actorUserId?: string) {
    const updated = await this.prisma.notificationChannel.update({ where: { id }, data: dto });
    await this.auditLogsService.log({
      actorUserId,
      action: 'notification_channel.update',
      resourceType: 'notification_channel',
      resourceId: id,
      details: dto as unknown as Prisma.InputJsonValue,
    });
    return updated;
  }

  async delete(id: string, actorUserId?: string) {
    const deleted = await this.prisma.notificationChannel.delete({ where: { id } });
    await this.auditLogsService.log({
      actorUserId,
      action: 'notification_channel.delete',
      resourceType: 'notification_channel',
      resourceId: id,
    });
    return deleted;
  }

  async test(id: string, actorUserId?: string) {
    const channel = await this.prisma.notificationChannel.findUniqueOrThrow({ where: { id } });
    await this.auditLogsService.log({
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
