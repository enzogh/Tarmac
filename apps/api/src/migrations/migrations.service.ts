import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AgentsService } from '../agents/agents.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMigrationDto } from './dto/create-migration.dto';
import { UpdateMigrationDto } from './dto/update-migration.dto';

type MigrationNotesMetadata = {
  reason?: string;
  sourcePath?: string;
  targetPath?: string;
  notes?: string;
};

@Injectable()
export class MigrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agentsService: AgentsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private parseNotesMetadata(value?: string | null): MigrationNotesMetadata {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value) as MigrationNotesMetadata;
      if (typeof parsed !== 'object' || parsed === null) return { notes: value };
      return {
        reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        sourcePath: typeof parsed.sourcePath === 'string' ? parsed.sourcePath : undefined,
        targetPath: typeof parsed.targetPath === 'string' ? parsed.targetPath : undefined,
        notes: typeof parsed.notes === 'string' ? parsed.notes : undefined,
      };
    } catch {
      return { notes: value };
    }
  }

  private serializeNotes(dto: CreateMigrationDto): string | undefined {
    if (!dto.notes && !dto.reason && !dto.sourcePath && !dto.targetPath) return undefined;
    return JSON.stringify({
      notes: dto.notes ?? null,
      reason: dto.reason ?? null,
      sourcePath: dto.sourcePath ?? null,
      targetPath: dto.targetPath ?? null,
    });
  }

  private withMetadata<T extends { notes?: string | null }>(migration: T) {
    return {
      ...migration,
      ...this.parseNotesMetadata(migration.notes),
    };
  }

  async list() {
    const migrations = await this.prisma.migrationTask.findMany({
      orderBy: { createdAt: 'desc' },
      include: { sourceNode: true, targetNode: true },
    });
    return migrations.map((migration) => this.withMetadata(migration));
  }

  async create(dto: CreateMigrationDto, actorUserId?: string) {
    const created = await this.prisma.migrationTask.create({
      data: {
        name: dto.name,
        shareId: dto.shareId,
        sourceNodeId: dto.sourceNodeId,
        targetNodeId: dto.targetNodeId,
        notes: this.serializeNotes(dto),
      },
      include: { sourceNode: true, targetNode: true },
    });
    await this.auditLogsService.log({
      actorUserId,
      action: 'migration.create',
      resourceType: 'migration',
      resourceId: created.id,
      details: dto as unknown as Prisma.InputJsonValue,
    });
    return this.withMetadata(created);
  }

  async update(id: string, dto: UpdateMigrationDto, actorUserId?: string) {
    const existing = await this.prisma.migrationTask.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('migration not found');
    }

    const updatesRouting = dto.sourceNodeId !== undefined || dto.targetNodeId !== undefined;
    if (updatesRouting && !['pending', 'failed'].includes(existing.status)) {
      throw new BadRequestException('only pending or failed migrations can be edited');
    }

    const payload: Prisma.MigrationTaskUpdateInput = { ...dto };
    if (dto.status === 'running') payload.startedAt = new Date();
    if (dto.status === 'completed') {
      payload.completedAt = new Date();
      payload.progress = 100;
    }
    if (dto.status === 'failed') {
      payload.completedAt = new Date();
    }
    if (dto.status === 'pending') {
      payload.startedAt = null;
      payload.completedAt = null;
      if (dto.progress === undefined) {
        payload.progress = 0;
      }
    }

    const updated = await this.prisma.migrationTask.update({
      where: { id },
      data: payload,
      include: { sourceNode: true, targetNode: true },
    });
    await this.auditLogsService.log({
      actorUserId,
      action: 'migration.update',
      resourceType: 'migration',
      resourceId: id,
      details: dto as unknown as Prisma.InputJsonValue,
    });
    return this.withMetadata(updated);
  }

  async listDirectories(nodeId: string, basePath = '/') {
    return this.agentsService.requestDirectories(nodeId, basePath);
  }

  async scanDirectories(nodeId: string, basePath = '/', maxEntries = 20) {
    return this.agentsService.requestDirectoryScan(nodeId, basePath, maxEntries);
  }

  async start(id: string, actorUserId?: string) {
    const migration = await this.prisma.migrationTask.findUniqueOrThrow({
      where: { id },
      include: { sourceNode: true, targetNode: true },
    });
    const metadata = this.parseNotesMetadata(migration.notes);

    const sourcePath = metadata.sourcePath?.trim();
    const targetPath = metadata.targetPath?.trim();
    if (!sourcePath || !targetPath) {
      throw new BadRequestException('Migration paths are missing');
    }

    if (!migration.targetNodeId) {
      throw new BadRequestException('Target node is missing');
    }

    const sourceHost =
      migration.sourceNodeId && migration.targetNodeId !== migration.sourceNodeId
        ? migration.sourceNode?.vlanIp ?? undefined
        : undefined;
    const sourceUser =
      migration.sourceNodeId && migration.targetNodeId !== migration.sourceNodeId
        ? migration.sourceNode?.overlaySshUser ?? 'root'
        : undefined;

    const updated = await this.prisma.migrationTask.update({
      where: { id },
      data: { status: 'running', progress: 0, startedAt: new Date(), completedAt: null },
      include: { sourceNode: true, targetNode: true },
    });

    const sent = this.agentsService.sendCommand(migration.targetNodeId, {
      type: 'command.run_rsync',
      payload: {
        resourceType: 'migration',
        resourceId: migration.id,
        sourcePath,
        targetPath,
        sourceHost,
        sourceUser,
      },
    });

    if (!sent) {
      const failed = await this.prisma.migrationTask.update({
        where: { id },
        data: { status: 'failed' },
        include: { sourceNode: true, targetNode: true },
      });
      return this.withMetadata(failed);
    }

    await this.auditLogsService.log({
      actorUserId,
      action: 'migration.start',
      resourceType: 'migration',
      resourceId: migration.id,
      details: {
        sourcePath,
        targetPath,
        sourceHost: sourceHost ?? null,
        sourceUser: sourceUser ?? null,
        targetNodeId: migration.targetNodeId,
      },
    });

    return this.withMetadata(updated);
  }

  async retry(id: string, actorUserId?: string) {
    const existing = await this.prisma.migrationTask.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('migration not found');
    }
    if (existing.status !== 'failed') {
      throw new BadRequestException('only failed migrations can be retried');
    }

    await this.prisma.migrationTask.update({
      where: { id },
      data: {
        status: 'pending',
        progress: 0,
        startedAt: null,
        completedAt: null,
      },
    });
    await this.auditLogsService.log({
      actorUserId,
      action: 'migration.retry',
      resourceType: 'migration',
      resourceId: id,
      details: { previousStatus: existing.status } as Prisma.InputJsonValue,
    });
    return this.start(id, actorUserId);
  }

  async stop(id: string, actorUserId?: string) {
    const existing = await this.prisma.migrationTask.findUnique({
      where: { id },
      include: { sourceNode: true, targetNode: true },
    });
    if (!existing) {
      throw new NotFoundException('migration not found');
    }
    if (existing.status !== 'running') {
      throw new BadRequestException('only running migrations can be stopped');
    }
    if (!existing.targetNodeId) {
      throw new BadRequestException('target node is missing');
    }

    const sent = this.agentsService.sendCommand(existing.targetNodeId, {
      type: 'command.stop_rsync',
      payload: {
        resourceType: 'migration',
        resourceId: existing.id,
      },
    });
    if (!sent) {
      throw new BadRequestException('target node is offline');
    }

    const updated = await this.prisma.migrationTask.update({
      where: { id },
      data: {
        status: 'failed',
        completedAt: new Date(),
      },
      include: { sourceNode: true, targetNode: true },
    });

    await this.auditLogsService.log({
      actorUserId,
      action: 'migration.stop',
      resourceType: 'migration',
      resourceId: id,
      details: { previousStatus: existing.status } as Prisma.InputJsonValue,
    });

    return this.withMetadata(updated);
  }

  async removePending(id: string, actorUserId?: string) {
    const existing = await this.prisma.migrationTask.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException('migration not found');
    }
    if (existing.status !== 'pending') {
      throw new BadRequestException('only pending migrations can be deleted');
    }

    await this.prisma.migrationTask.delete({ where: { id } });
    await this.auditLogsService.log({
      actorUserId,
      action: 'migration.delete',
      resourceType: 'migration',
      resourceId: id,
      details: { status: existing.status } as Prisma.InputJsonValue,
    });
  }
}
