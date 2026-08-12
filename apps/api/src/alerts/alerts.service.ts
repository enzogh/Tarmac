import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { scopeWhere, WorkspaceScope } from '../auth/workspace.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAlertDto } from './dto/create-alert.dto';

@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  list(scope: WorkspaceScope) {
    return this.prisma.alert.findMany({
      where: scopeWhere(scope),
      orderBy: { triggeredAt: 'desc' },
      include: { rule: true, node: true },
      take: 300,
    });
  }

  private async assertOwned(id: string, scope: WorkspaceScope) {
    const alert = await this.prisma.alert.findFirst({ where: { id, workspaceId: scope.workspaceId }, select: { id: true } });
    if (!alert) throw new NotFoundException('alert not found');
  }

  async create(dto: CreateAlertDto, scope: WorkspaceScope, actorUserId?: string) {
    const created = await this.prisma.alert.create({
      data: { ...dto, workspaceId: scope.workspaceId as string },
      include: { node: true, rule: true },
    });
    await this.auditLogsService.log({
      actorUserId,
      action: 'alert.create',
      resourceType: 'alert',
      resourceId: created.id,
      details: dto as unknown as Prisma.InputJsonValue,
    });
    return created;
  }

  async acknowledge(id: string, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertOwned(id, scope);
    const updated = await this.prisma.alert.update({
      where: { id },
      data: { status: 'acknowledged', acknowledgedAt: new Date() },
    });
    await this.auditLogsService.log({
      actorUserId,
      action: 'alert.ack',
      resourceType: 'alert',
      resourceId: id,
    });
    return updated;
  }

  async resolve(id: string, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertOwned(id, scope);
    const updated = await this.prisma.alert.update({
      where: { id },
      data: { status: 'resolved', resolvedAt: new Date() },
    });
    await this.auditLogsService.log({
      actorUserId,
      action: 'alert.resolve',
      resourceType: 'alert',
      resourceId: id,
    });
    return updated;
  }

  async remove(id: string, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertOwned(id, scope);
    const deleted = await this.prisma.alert.delete({ where: { id } });
    await this.auditLogsService.log({
      actorUserId,
      action: 'alert.delete',
      resourceType: 'alert',
      resourceId: id,
    });
    return deleted;
  }

  async removeMany(ids: string[], scope: WorkspaceScope, actorUserId?: string) {
    const uniqueIds = [...new Set(ids)];
    const { count } = await this.prisma.alert.deleteMany({
      where: { id: { in: uniqueIds }, ...scopeWhere(scope) },
    });
    await this.auditLogsService.log({
      actorUserId,
      action: 'alert.bulk_delete',
      resourceType: 'alert',
      details: { ids: uniqueIds, count } as unknown as Prisma.InputJsonValue,
    });
    return { count };
  }
}
