import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { scopeWhere, WorkspaceScope } from '../auth/workspace.guard';
import { internalMailDomain, parseChannelTargets } from '../mail/alert-recipients';
import { MailService } from '../mail/mail.service';
import { renderNotificationAddress } from '../mail/templates/notification-address';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNotificationChannelDto } from './dto/create-notification-channel.dto';
import { UpdateNotificationChannelDto } from './dto/update-notification-channel.dto';

@Injectable()
export class NotificationChannelsService {
  private readonly logger = new Logger(NotificationChannelsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly mailService: MailService,
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
    const channel = await this.prisma.notificationChannel.findUniqueOrThrow({
      where: { id },
      include: { workspace: { select: { name: true, slug: true } } },
    });
    if (channel.type === 'email') {
      await this.sendTestEmails(channel.target, channel.workspace);
    }
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

  // Email is the only channel type with a real transport today; webhook and
  // slack tests keep their previous log-only behaviour.
  private async sendTestEmails(target: string, workspace: { name: string; slug: string }) {
    if (!this.mailService.isConfigured) {
      throw new ServiceUnavailableException("L'envoi d'emails n'est pas configuré (SMTP_HOST ou SMTP_PASSWORD manquant)");
    }
    const recipients = parseChannelTargets(target);
    if (recipients.length === 0) {
      throw new BadRequestException('Aucune adresse email valide dans la cible de ce canal');
    }
    for (const recipient of recipients) {
      try {
        await this.mailService.send(
          recipient,
          renderNotificationAddress({
            kind: 'test',
            recipient,
            source: 'channel',
            internalDomain: internalMailDomain(),
            frontendUrl: this.mailService.frontendUrl,
            workspaceName: workspace.name,
            workspaceSlug: workspace.slug,
          }),
        );
      } catch (error) {
        this.logger.warn(`Test email to ${recipient} failed: ${error instanceof Error ? error.message : error}`);
        throw new ServiceUnavailableException(`Le relais SMTP a refusé l'envoi vers ${recipient}`);
      }
    }
  }
}
