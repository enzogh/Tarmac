import {
  BadRequestException,
  forwardRef,
  GatewayTimeoutException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AgentsService } from '../agents/agents.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { scopeWhere, WorkspaceScope } from '../auth/workspace.guard';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_WORKSPACE_ID } from '../workspaces/default-workspace';
import { CreateMigrationDto } from './dto/create-migration.dto';
import { UpdateMigrationDto } from './dto/update-migration.dto';

const AUTO_REMEDIATION_PREFIX = '[Auto]';

type MigrationEndpointKind = 'node' | 'seedbox' | 'storagebox';
type RemoteEndpointType = 'seedbox' | 'storagebox';

type MigrationNotesMetadata = {
  reason?: string;
  sourcePath?: string;
  targetPath?: string;
  notes?: string;
  sourceKind?: MigrationEndpointKind;
  targetKind?: MigrationEndpointKind;
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
    @Inject(forwardRef(() => AgentsService))
    private readonly agentsService: AgentsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private normalizeFailureMessage(message?: string | null) {
    if (!message) return 'unknown error';
    const compact = message.replace(/\s+/g, ' ').trim();
    return compact.length > 700 ? `${compact.slice(0, 697)}...` : compact;
  }

  private async createMigrationFailureAlert(params: {
    migrationId: string;
    migrationName: string;
    nodeId?: string | null;
    sourceName?: string | null;
    targetName?: string | null;
    progress: number;
    errorMessage: string;
  }) {
    const source = params.sourceName?.trim() || 'unknown-source';
    const target = params.targetName?.trim() || 'unknown-target';
    const message = `Migration "${params.migrationName}" failed at ${params.progress}% (${source} -> ${target}): ${params.errorMessage}`;

    await this.prisma.alert.create({
      data: {
        workspaceId: DEFAULT_WORKSPACE_ID,
        nodeId: params.nodeId ?? null,
        severity: 'high',
        message,
      },
    });
  }

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

  private normalizeEndpointKind(
    value?: string | null,
    fallback: MigrationEndpointKind | undefined = 'node',
  ): MigrationEndpointKind | undefined {
    if (value === 'seedbox' || value === 'storagebox' || value === 'node') return value;
    return fallback;
  }

  private toRemoteEndpointType(kind: MigrationEndpointKind): RemoteEndpointType | undefined {
    if (kind === 'seedbox' || kind === 'storagebox') return kind;
    return undefined;
  }

  private resolveRemotePort(port: number | undefined, endpointType: RemoteEndpointType): number {
    if (typeof port === 'number' && Number.isFinite(port) && port > 0 && port <= 65535) {
      return port;
    }
    return endpointType === 'storagebox' ? 23 : 22;
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
        sourceKind: this.normalizeEndpointKind(parsed.sourceKind, undefined),
        targetKind: this.normalizeEndpointKind(parsed.targetKind, undefined),
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

  async list(scope: WorkspaceScope) {
    const migrations = await this.prisma.migrationTask.findMany({
      where: scopeWhere(scope),
      orderBy: { createdAt: 'desc' },
      include: { sourceNode: true, targetNode: true },
      take: 200,
    });
    return migrations.map((migration) => this.withMetadata(migration));
  }

  private async assertOwned(id: string, scope: WorkspaceScope): Promise<void> {
    const task = await this.prisma.migrationTask.findFirst({
      where: { id, workspaceId: scope.workspaceId },
      select: { id: true },
    });
    if (!task) throw new NotFoundException('migration not found');
  }

  private async assertNodeOwned(nodeId: string, scope: WorkspaceScope): Promise<void> {
    const node = await this.prisma.node.findFirst({
      where: { id: nodeId, workspaceId: scope.workspaceId },
      select: { id: true },
    });
    if (!node) throw new NotFoundException('node not found');
  }

  async create(dto: CreateMigrationDto, scope: WorkspaceScope, actorUserId?: string) {
    const created = await this.prisma.migrationTask.create({
      data: {
        workspaceId: scope.workspaceId as string,
        name: dto.name,
        shareId: dto.shareId,
        sourceNodeId: dto.sourceNodeId,
        targetNodeId: dto.targetNodeId,
        notes: this.serializeNotes(dto),
      },
      include: { sourceNode: true, targetNode: true },
    });
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'migration.create',
      resourceType: 'migration',
      resourceId: created.id,
      details: dto as unknown as Prisma.InputJsonValue,
    });
    return this.withMetadata(created);
  }

  // Called when a disk goes SMART-critical: proposes (never auto-starts) a
  // migration off the affected node so an admin can secure the data before
  // the disk fails outright. The task is created 'pending' — someone still
  // has to hit "Démarrer" for any data to actually move.
  async suggestMigrationForCriticalDisk(params: { nodeId: string; diskName: string; mountPath: string }) {
    const existing = await this.prisma.migrationTask.findFirst({
      where: {
        sourceNodeId: params.nodeId,
        status: { in: ['pending', 'running'] },
        name: { startsWith: AUTO_REMEDIATION_PREFIX },
      },
    });
    if (existing) return null;

    const sourceNode = await this.prisma.node.findUnique({ where: { id: params.nodeId } });
    if (!sourceNode) return null;

    // Never suggest migrating a critical disk's data across a workspace
    // boundary - candidates are restricted to the source node's own workspace.
    const [candidateNodes, disks] = await Promise.all([
      this.prisma.node.findMany({
        where: { status: 'online', id: { not: params.nodeId }, workspaceId: sourceNode.workspaceId },
      }),
      this.prisma.disk.findMany({ where: { node: { workspaceId: sourceNode.workspaceId } } }),
    ]);
    if (candidateNodes.length === 0) return null;

    const freeGbByNode = new Map<string, number>();
    for (const disk of disks) {
      const free = disk.capacityGb - disk.usedGb;
      freeGbByNode.set(disk.nodeId, (freeGbByNode.get(disk.nodeId) ?? 0) + free);
    }

    const targetNode = candidateNodes
      .map((node) => ({ node, freeGb: freeGbByNode.get(node.id) ?? 0 }))
      .sort((a, b) => b.freeGb - a.freeGb)[0]?.node;
    if (!targetNode) return null;

    return this.create(
      {
        name: `${AUTO_REMEDIATION_PREFIX} sécurisation disque "${params.diskName}" (${sourceNode.name})`,
        sourceNodeId: params.nodeId,
        targetNodeId: targetNode.id,
        sourcePath: params.mountPath,
        targetPath: params.mountPath,
        reason: 'Disque en échec SMART critique : sécurisation préventive des données avant perte.',
        sourceKind: 'node',
        targetKind: 'node',
      },
      {
        isPlatformAdmin: false,
        workspaceId: sourceNode.workspaceId,
        allowedWorkspaceIds: [sourceNode.workspaceId],
        isManager: false,
      },
    );
  }

  async update(id: string, dto: UpdateMigrationDto, scope: WorkspaceScope, actorUserId?: string) {
    const existing = await this.prisma.migrationTask.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== scope.workspaceId) {
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
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'migration.update',
      resourceType: 'migration',
      resourceId: id,
      details: dto as unknown as Prisma.InputJsonValue,
    });
    return this.withMetadata(updated);
  }

  async listDirectories(nodeId: string, basePath = '/', scope: WorkspaceScope) {
    await this.assertNodeOwned(nodeId, scope);
    try {
      return await this.agentsService.requestDirectories(nodeId, basePath);
    } catch (error) {
      this.rethrowDirectoryRequestError(error, 'Unable to list directories from the selected node');
    }
  }

  async scanDirectories(nodeId: string, basePath = '/', maxEntries = 20, scope: WorkspaceScope) {
    await this.assertNodeOwned(nodeId, scope);
    try {
      return await this.agentsService.requestDirectoryScan(nodeId, basePath, maxEntries);
    } catch (error) {
      this.rethrowDirectoryRequestError(error, 'Unable to scan directories from the selected node');
    }
  }

  async listRemoteDirectories(
    nodeId: string,
    payload: {
      host: string;
      username: string;
      password?: string;
      port?: number;
      basePath?: string;
      endpointType?: RemoteEndpointType;
    },
    scope: WorkspaceScope,
  ) {
    await this.assertNodeOwned(nodeId, scope);
    try {
      const endpointType = payload.endpointType === 'storagebox' ? 'storagebox' : 'seedbox';
      return await this.agentsService.requestRemoteDirectories(nodeId, {
        host: payload.host,
        username: payload.username,
        password: payload.password,
        port: this.resolveRemotePort(payload.port, endpointType),
        basePath: payload.basePath ?? (endpointType === 'storagebox' ? '/home' : '/'),
        endpointType,
      });
    } catch (error) {
      this.rethrowDirectoryRequestError(error, 'Unable to list directories from the selected remote endpoint');
    }
  }

  async start(id: string, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertOwned(id, scope);
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

    const sourceKind = this.normalizeEndpointKind(metadata.sourceKind, 'node') ?? 'node';
    const targetKind = this.normalizeEndpointKind(metadata.targetKind, 'node') ?? 'node';

    const sourceRemoteType = this.toRemoteEndpointType(sourceKind);
    const targetRemoteType = this.toRemoteEndpointType(targetKind);

    if (sourceRemoteType && targetRemoteType) {
      throw new BadRequestException('At least one side must be a node managed by Tarmac');
    }

    let executionNodeId: string | undefined;
    if (targetRemoteType) {
      executionNodeId = migration.sourceNodeId ?? undefined;
      if (!executionNodeId) {
        throw new BadRequestException('Source node is required when destination is remote');
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
    if (sourceRemoteType) {
      sourceHost = metadata.sourceSeedboxHost?.trim();
      sourceUser = metadata.sourceSeedboxUser?.trim();
      sourcePassword = metadata.sourceSeedboxPassword;
      sourceSshPort = this.resolveRemotePort(metadata.sourceSeedboxPort, sourceRemoteType);
      if (!sourceHost || !sourceUser) {
        throw new BadRequestException('Remote source credentials are incomplete');
      }
    } else if (migration.sourceNodeId && executionNodeId !== migration.sourceNodeId) {
      sourceHost = migration.sourceNode?.vlanIp ?? undefined;
      sourceUser = migration.sourceNode?.overlaySshUser ?? 'root';
    }

    let targetHost: string | undefined;
    let targetUser: string | undefined;
    let targetPassword: string | undefined;
    let targetSshPort: number | undefined;
    if (targetRemoteType) {
      targetHost = metadata.targetSeedboxHost?.trim();
      targetUser = metadata.targetSeedboxUser?.trim();
      targetPassword = metadata.targetSeedboxPassword;
      targetSshPort = this.resolveRemotePort(metadata.targetSeedboxPort, targetRemoteType);
      if (!targetHost || !targetUser) {
        throw new BadRequestException('Remote destination credentials are incomplete');
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
        data: { status: 'failed', completedAt: new Date() },
        include: { sourceNode: true, targetNode: true },
      });
      const offlineMessage = this.normalizeFailureMessage(
        `execution node "${executionNodeId}" is offline or disconnected`,
      );
      await this.createMigrationFailureAlert({
        migrationId: failed.id,
        migrationName: failed.name,
        nodeId: executionNodeId,
        sourceName: failed.sourceNode?.name,
        targetName: failed.targetNode?.name,
        progress: failed.progress,
        errorMessage: offlineMessage,
      });
      return this.withMetadata(failed);
    }

    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
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

  async retry(id: string, scope: WorkspaceScope, actorUserId?: string) {
    const existing = await this.prisma.migrationTask.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== scope.workspaceId) {
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
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'migration.retry',
      resourceType: 'migration',
      resourceId: id,
      details: { previousStatus: existing.status } as Prisma.InputJsonValue,
    });
    return this.start(id, scope, actorUserId);
  }

  async stop(id: string, scope: WorkspaceScope, actorUserId?: string) {
    const existing = await this.prisma.migrationTask.findUnique({
      where: { id },
      include: { sourceNode: true, targetNode: true },
    });
    if (!existing || existing.workspaceId !== scope.workspaceId) {
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
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'migration.stop',
      resourceType: 'migration',
      resourceId: id,
      details: { previousStatus: existing.status } as Prisma.InputJsonValue,
    });

    return this.withMetadata(updated);
  }

  async removePending(id: string, scope: WorkspaceScope, actorUserId?: string) {
    const existing = await this.prisma.migrationTask.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== scope.workspaceId) {
      throw new NotFoundException('migration not found');
    }
    if (existing.status !== 'pending') {
      throw new BadRequestException('only pending migrations can be deleted');
    }

    await this.prisma.migrationTask.delete({ where: { id } });
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'migration.delete',
      resourceType: 'migration',
      resourceId: id,
      details: { status: existing.status } as Prisma.InputJsonValue,
    });
  }
}
