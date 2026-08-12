import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { scopeWhere, WorkspaceScope } from '../auth/workspace.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAlertRuleDto } from './dto/create-alert-rule.dto';
import { UpdateAlertRuleDto } from './dto/update-alert-rule.dto';

@Injectable()
export class AlertRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  list(scope: WorkspaceScope) {
    return this.prisma.alertRule.findMany({
      where: scopeWhere(scope),
      orderBy: { createdAt: 'desc' },
      include: { node: true, notificationChannel: true },
    });
  }

  private async assertOwned(id: string, scope: WorkspaceScope) {
    const rule = await this.prisma.alertRule.findFirst({ where: { id, workspaceId: scope.workspaceId }, select: { id: true } });
    if (!rule) throw new NotFoundException('alert rule not found');
  }

  async create(dto: CreateAlertRuleDto, scope: WorkspaceScope, actorUserId?: string) {
    const created = await this.prisma.alertRule.create({ data: { ...dto, workspaceId: scope.workspaceId as string } });
    await this.auditLogsService.log({
      actorUserId,
      action: 'alert_rule.create',
      resourceType: 'alert_rule',
      resourceId: created.id,
      details: dto as unknown as Prisma.InputJsonValue,
    });
    return created;
  }

  async update(id: string, dto: UpdateAlertRuleDto, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertOwned(id, scope);
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

  async delete(id: string, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertOwned(id, scope);
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
