import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMigrationDto } from './dto/create-migration.dto';
import { UpdateMigrationDto } from './dto/update-migration.dto';

@Injectable()
export class MigrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  list() {
    return this.prisma.migrationTask.findMany({
      orderBy: { createdAt: 'desc' },
      include: { sourceNode: true, targetNode: true },
    });
  }

  async create(dto: CreateMigrationDto, actorUserId?: string) {
    const created = await this.prisma.migrationTask.create({ data: dto });
    await this.auditLogsService.log({
      actorUserId,
      action: 'migration.create',
      resourceType: 'migration',
      resourceId: created.id,
      details: dto as unknown as Prisma.InputJsonValue,
    });
    return created;
  }

  async update(id: string, dto: UpdateMigrationDto, actorUserId?: string) {
    const payload: Prisma.MigrationTaskUpdateInput = { ...dto };
    if (dto.status === 'running') payload.startedAt = new Date();
    if (dto.status === 'completed') {
      payload.completedAt = new Date();
      payload.progress = 100;
    }

    const updated = await this.prisma.migrationTask.update({ where: { id }, data: payload });
    await this.auditLogsService.log({
      actorUserId,
      action: 'migration.update',
      resourceType: 'migration',
      resourceId: id,
      details: dto as unknown as Prisma.InputJsonValue,
    });
    return updated;
  }
}
