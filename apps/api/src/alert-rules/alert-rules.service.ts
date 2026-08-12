import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_WORKSPACE_ID } from '../workspaces/default-workspace';
import { CreateAlertRuleDto } from './dto/create-alert-rule.dto';
import { UpdateAlertRuleDto } from './dto/update-alert-rule.dto';

@Injectable()
export class AlertRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  list() {
    return this.prisma.alertRule.findMany({
      orderBy: { createdAt: 'desc' },
      include: { node: true, notificationChannel: true },
    });
  }

  async create(dto: CreateAlertRuleDto, actorUserId?: string) {
    const created = await this.prisma.alertRule.create({ data: { ...dto, workspaceId: DEFAULT_WORKSPACE_ID } });
    await this.auditLogsService.log({
      actorUserId,
      action: 'alert_rule.create',
      resourceType: 'alert_rule',
      resourceId: created.id,
      details: dto as unknown as Prisma.InputJsonValue,
    });
    return created;
  }

  async update(id: string, dto: UpdateAlertRuleDto, actorUserId?: string) {
    const updated = await this.prisma.alertRule.update({ where: { id }, data: dto });
    await this.auditLogsService.log({
      actorUserId,
      action: 'alert_rule.update',
      resourceType: 'alert_rule',
      resourceId: id,
      details: dto as unknown as Prisma.InputJsonValue,
    });
    return updated;
  }

  async delete(id: string, actorUserId?: string) {
    const deleted = await this.prisma.alertRule.delete({ where: { id } });
    await this.auditLogsService.log({
      actorUserId,
      action: 'alert_rule.delete',
      resourceType: 'alert_rule',
      resourceId: id,
    });
    return deleted;
  }
}
