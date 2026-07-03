import {
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
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
  sourceKind?: 'node' | 'seedbox';
  targetKind?: 'node' | 'seedbox';
  sourceSeedboxHost?: string;
  sourceSeedboxUser?: string;
  sourceSeedboxPassword?: string;
  sourceSeedboxPort?: number;
  targetSeedboxHost?: string;
  targetSeedboxUser?: string;
  targetSeedboxPassword?: string;
  targetSeedboxPort?: number;
};

@Injectable()
export class MigrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agentsService: AgentsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private rethrowDirectoryRequestError(error: unknown, fallbackMessage: string): never {
    const message = error instanceof Error ? error.message.trim() : fallbackMessage;
    const normalized = message.toLowerCase();

    if (normalized.includes('timeout')) {
      throw new GatewayTimeoutException(message || fallbackMessage);
    }
    if (normalized.includes('offline') || normalized.includes('disconnected')) {
      throw new ServiceUnavailableException(message || fallbackMessage);
    }
    throw new BadRequestException(message || fallbackMessage);
  }

  private parseNotesMetadata(value?: string | null, includeSecrets = false): MigrationNotesMetadata {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value) as MigrationNotesMetadata;
      if (typeof parsed !== 'object' || parsed === null) return { notes: value };
      return {
        reason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
        sourcePath: typeof parsed.sourcePath === 'string' ? parsed.sourcePath : undefined,
        targetPath: typeof parsed.targetPath === 'string' ? parsed.targetPath : undefined,
        notes: typeof parsed.notes === 'string' ? parsed.notes : undefined,
        sourceKind: parsed.sourceKind === 'seedbox' ? 'seedbox' : parsed.sourceKind === 'node' ? 'node' : undefined,
        targetKind: parsed.targetKind === 'seedbox' ? 'seedbox' : parsed.targetKind === 'node' ? 'node' : undefined,
        sourceSeedboxHost:
          typeof parsed.sourceSeedboxHost === 'string' ? parsed.sourceSeedboxHost : undefined,
        sourceSeedboxUser:
          typeof parsed.sourceSeedboxUser === 'string' ? parsed.sourceSeedboxUser : undefined,
        sourceSeedboxPassword:
          includeSecrets && typeof parsed.sourceSeedboxPassword === 'string'
            ? parsed.sourceSeedboxPassword
            : undefined,
        sourceSeedboxPort:
          typeof parsed.sourceSeedboxPort === 'number' ? parsed.sourceSeedboxPort : undefined,
        targetSeedboxHost:
          typeof parsed.targetSeedboxHost === 'string' ? parsed.targetSeedboxHost : undefined,
        targetSeedboxUser:
          typeof parsed.targetSeedboxUser === 'string' ? parsed.targetSeedboxUser : undefined,
        targetSeedboxPassword:
          includeSecrets && typeof parsed.targetSeedboxPassword === 'string'
            ? parsed.targetSeedboxPassword
            : undefined,
        targetSeedboxPort:
          typeof parsed.targetSeedboxPort === 'number' ? parsed.targetSeedboxPort : undefined,
      };
    } catch {
      return { notes: value };
    }
  }

  private serializeNotes(dto: CreateMigrationDto): string | undefined {
    if (
      !dto.notes &&
      !dto.reason &&
      !dto.sourcePath &&
      !dto.targetPath &&
      !dto.sourceKind &&
      !dto.targetKind &&
      !dto.sourceSeedboxHost &&
      !dto.sourceSeedboxUser &&
      !dto.sourceSeedboxPassword &&
      !dto.sourceSeedboxPort &&
      !dto.targetSeedboxHost &&
      !dto.targetSeedboxUser &&
      !dto.targetSeedboxPassword &&
      !dto.targetSeedboxPort
    )
      return undefined;
    const sourceSeedboxPort =
      dto.sourceSeedboxPort !== undefined ? Number.parseInt(dto.sourceSeedboxPort, 10) : undefined;
    const targetSeedboxPort =
      dto.targetSeedboxPort !== undefined ? Number.parseInt(dto.targetSeedboxPort, 10) : undefined;
    return JSON.stringify({
      notes: dto.notes ?? null,
      reason: dto.reason ?? null,
      sourcePath: dto.sourcePath ?? null,
      targetPath: dto.targetPath ?? null,
      sourceKind: dto.sourceKind ?? null,
      targetKind: dto.targetKind ?? null,
      sourceSeedboxHost: dto.sourceSeedboxHost ?? null,
      sourceSeedboxUser: dto.sourceSeedboxUser ?? null,
      sourceSeedboxPassword: dto.sourceSeedboxPassword ?? null,
      sourceSeedboxPort: Number.isFinite(sourceSeedboxPort) ? sourceSeedboxPort : null,
      targetSeedboxHost: dto.targetSeedboxHost ?? null,
      targetSeedboxUser: dto.targetSeedboxUser ?? null,
      targetSeedboxPassword: dto.targetSeedboxPassword ?? null,
      targetSeedboxPort: Number.isFinite(targetSeedboxPort) ? targetSeedboxPort : null,
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
    try {
      return await this.agentsService.requestDirectories(nodeId, basePath);
    } catch (error) {
      this.rethrowDirectoryRequestError(error, 'Unable to list directories from the selected node');
    }
  }

  async scanDirectories(nodeId: string, basePath = '/', maxEntries = 20) {
    try {
      return await this.agentsService.requestDirectoryScan(nodeId, basePath, maxEntries);
    } catch (error) {
      this.rethrowDirectoryRequestError(error, 'Unable to scan directories from the selected node');
    }
  }

  async listRemoteDirectories(
    nodeId: string,
    payload: { host: string; username: string; password?: string; port?: number; basePath?: string },
  ) {
    try {
      return await this.agentsService.requestRemoteDirectories(nodeId, {
        host: payload.host,
        username: payload.username,
        password: payload.password,
        port: payload.port,
        basePath: payload.basePath,
      });
    } catch (error) {
      this.rethrowDirectoryRequestError(error, 'Unable to list directories from the selected remote endpoint');
    }
  }

  async start(id: string, actorUserId?: string) {
    const migration = await this.prisma.migrationTask.findUniqueOrThrow({
      where: { id },
      include: { sourceNode: true, targetNode: true },
    });
    const metadata = this.parseNotesMetadata(migration.notes, true);

    const sourcePath = metadata.sourcePath?.trim();
    const targetPath = metadata.targetPath?.trim();
    if (!sourcePath || !targetPath) {
      throw new BadRequestException('Migration paths are missing');
    }

    const sourceKind = metadata.sourceKind === 'seedbox' ? 'seedbox' : 'node';
    const targetKind = metadata.targetKind === 'seedbox' ? 'seedbox' : 'node';

    if (sourceKind === 'seedbox' && targetKind === 'seedbox') {
      throw new BadRequestException('At least one side must be a node managed by Tarmac');
    }

    let executionNodeId: string | undefined;
    if (targetKind === 'seedbox') {
      executionNodeId = migration.sourceNodeId ?? undefined;
      if (!executionNodeId) {
        throw new BadRequestException('Source node is required when destination is a seedbox');
      }
    } else {
      executionNodeId = migration.targetNodeId ?? undefined;
      if (!executionNodeId) {
        throw new BadRequestException('Target node is required');
      }
    }

    let sourceHost: string | undefined;
    let sourceUser: string | undefined;
    let sourcePassword: string | undefined;
    let sourceSshPort: number | undefined;
    if (sourceKind === 'seedbox') {
      sourceHost = metadata.sourceSeedboxHost?.trim();
      sourceUser = metadata.sourceSeedboxUser?.trim();
      sourcePassword = metadata.sourceSeedboxPassword;
      sourceSshPort = metadata.sourceSeedboxPort;
      if (!sourceHost || !sourceUser) {
        throw new BadRequestException('Seedbox source credentials are incomplete');
      }
    } else if (migration.sourceNodeId && executionNodeId !== migration.sourceNodeId) {
      sourceHost = migration.sourceNode?.vlanIp ?? undefined;
      sourceUser = migration.sourceNode?.overlaySshUser ?? 'root';
    }

    let targetHost: string | undefined;
    let targetUser: string | undefined;
    let targetPassword: string | undefined;
    let targetSshPort: number | undefined;
    if (targetKind === 'seedbox') {
      targetHost = metadata.targetSeedboxHost?.trim();
      targetUser = metadata.targetSeedboxUser?.trim();
      targetPassword = metadata.targetSeedboxPassword;
      targetSshPort = metadata.targetSeedboxPort;
      if (!targetHost || !targetUser) {
        throw new BadRequestException('Seedbox destination credentials are incomplete');
      }
    }

    const updated = await this.prisma.migrationTask.update({
      where: { id },
      data: { status: 'running', progress: 0, startedAt: new Date(), completedAt: null },
      include: { sourceNode: true, targetNode: true },
    });

    const sent = this.agentsService.sendCommand(executionNodeId, {
      type: 'command.run_rsync',
      payload: {
        resourceType: 'migration',
        resourceId: migration.id,
        sourcePath,
        targetPath,
        sourceHost,
        sourceUser,
        sourcePassword,
        sourceSshPort,
        targetHost,
        targetUser,
        targetPassword,
        targetSshPort,
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
        sourceKind,
        targetKind,
        sourceHost: sourceHost ?? null,
        sourceUser: sourceUser ?? null,
        targetHost: targetHost ?? null,
        targetUser: targetUser ?? null,
        executionNodeId,
        targetNodeId: migration.targetNodeId ?? null,
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
