import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAlertDto } from './dto/create-alert.dto';

@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  list() {
    return this.prisma.alert.findMany({
      orderBy: { triggeredAt: 'desc' },
      include: { rule: true, node: true },
      take: 300,
    });
  }

  async create(dto: CreateAlertDto, actorUserId?: string) {
    const created = await this.prisma.alert.create({ data: dto, include: { node: true, rule: true } });
    await this.auditLogsService.log({
      actorUserId,
      action: 'alert.create',
      resourceType: 'alert',
      resourceId: created.id,
      details: dto as unknown as Prisma.InputJsonValue,
    });
    return created;
  }

  async acknowledge(id: string, actorUserId?: string) {
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

  async resolve(id: string, actorUserId?: string) {
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

  async remove(id: string, actorUserId?: string) {
    const deleted = await this.prisma.alert.delete({ where: { id } });
    await this.auditLogsService.log({
      actorUserId,
      action: 'alert.delete',
      resourceType: 'alert',
      resourceId: id,
    });
    return deleted;
  }

  async removeMany(ids: string[], actorUserId?: string) {
    const uniqueIds = [...new Set(ids)];
    const { count } = await this.prisma.alert.deleteMany({ where: { id: { in: uniqueIds } } });
    await this.auditLogsService.log({
      actorUserId,
      action: 'alert.bulk_delete',
      resourceType: 'alert',
      details: { ids: uniqueIds, count } as unknown as Prisma.InputJsonValue,
    });
    return { count };
  }
}
