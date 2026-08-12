import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma, SyncJobStatus } from '@prisma/client';
import { AgentsService } from '../agents/agents.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { scopeWhere, WorkspaceScope } from '../auth/workspace.guard';
import { DEFAULT_WORKSPACE_ID } from '../workspaces/default-workspace';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSyncJobDto } from './dto/create-sync-job.dto';
import { UpdateSyncJobDto } from './dto/update-sync-job.dto';
import { SyncJobTriggerService } from './sync-job-trigger.service';

@Injectable()
export class SyncJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agentsService: AgentsService,
    private readonly auditLogsService: AuditLogsService,
    private readonly syncJobTriggerService: SyncJobTriggerService,
  ) {}

  private normalizeFailureMessage(message?: string | null) {
    if (!message) return 'unknown error';
    const compact = message.replace(/\s+/g, ' ').trim();
    return compact.length > 700 ? `${compact.slice(0, 697)}...` : compact;
  }

  /**
   * Validates the optional per-trigger relative path (e.g. qBittorrent's
   * %N torrent name) used to scope a run to a single already-completed
   * item instead of the job's whole source folder. Rejects anything that
   * could escape the configured sourcePath or get interpreted as an rsync
   * flag on the remote end.
   */
  private resolveRelativePath(relativePath?: string): string | undefined {
    if (relativePath === undefined) return undefined;
    const trimmed = relativePath.trim();
    if (!trimmed) return undefined;
    if (trimmed.startsWith('-') || trimmed.startsWith('/') || trimmed.includes('..') || trimmed.includes('\0')) {
      throw new BadRequestException('invalid relativePath');
    }
    return trimmed;
  }

  private joinPath(base: string, sub: string): string {
    return `${base.replace(/\/+$/, '')}/${sub.replace(/^\/+/, '')}`;
  }

  private async createSyncJobFailureAlert(params: {
    syncJobId: string;
    syncJobName: string;
    nodeId?: string | null;
    errorMessage: string;
  }) {
    const message = `Réplication "${params.syncJobName}" en échec : ${params.errorMessage}`;

    await this.prisma.alert.create({
      data: {
        workspaceId: DEFAULT_WORKSPACE_ID,
        nodeId: params.nodeId ?? null,
        severity: 'high',
        message,
      },
    });
  }

  list(scope: WorkspaceScope) {
    return this.prisma.syncJob.findMany({
      where: scopeWhere(scope),
      orderBy: { createdAt: 'desc' },
      include: { node: true, runs: { orderBy: { startedAt: 'desc' }, take: 5 } },
      take: 200,
    });
  }

  private async assertOwned(id: string, scope: WorkspaceScope) {
    const job = await this.prisma.syncJob.findFirst({ where: { id, workspaceId: scope.workspaceId }, select: { id: true } });
    if (!job) throw new NotFoundException('sync job not found');
  }

  async listRuns(syncJobId: string, scope: WorkspaceScope) {
    await this.assertOwned(syncJobId, scope);
    return this.prisma.syncJobRun.findMany({ where: { syncJobId }, orderBy: { startedAt: 'desc' } });
  }

  listAllRuns(scope: WorkspaceScope) {
    return this.prisma.syncJobRun.findMany({
      where: { syncJob: { workspaceId: scope.workspaceId } },
      orderBy: { startedAt: 'desc' },
      include: { syncJob: true },
      take: 300,
    });
  }

  async create(dto: CreateSyncJobDto, scope: WorkspaceScope, actorUserId?: string) {
    const triggerToken = this.syncJobTriggerService.generate();
    const created = await this.prisma.syncJob.create({
      data: {
        ...dto,
        workspaceId: scope.workspaceId as string,
        triggerTokenHash: this.syncJobTriggerService.hash(triggerToken),
        triggerTokenRotatedAt: new Date(),
      },
    });
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'sync_job.create',
      resourceType: 'sync_job',
      resourceId: created.id,
      details: dto as unknown as Prisma.InputJsonValue,
    });
    // Only ever returned in plaintext at creation/rotation time; never persisted or logged.
    return { ...created, triggerToken };
  }

  async update(id: string, dto: UpdateSyncJobDto, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertOwned(id, scope);
    const updated = await this.prisma.syncJob.update({ where: { id }, data: dto });
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'sync_job.update',
      resourceType: 'sync_job',
      resourceId: id,
      details: dto as unknown as Prisma.InputJsonValue,
    });
    return updated;
  }

  async delete(id: string, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertOwned(id, scope);
    const deleted = await this.prisma.syncJob.delete({ where: { id } });
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'sync_job.delete',
      resourceType: 'sync_job',
      resourceId: id,
    });
    return deleted;
  }

  /**
   * relativePath (e.g. qBittorrent's %N torrent name) scopes this run to a
   * single item under the job's sourcePath/targetPath instead of the whole
   * folder - so a run triggered by torrent B completing doesn't re-pull
   * torrent A just because Radarr already moved it out of targetPath.
   * rsync's --delete only prunes within the directory it actually recurses
   * into, so scoping source/target to that one item keeps --delete from
   * touching anything else already staged.
   */
  async run(
    id: string,
    actorUserId?: string,
    trigger: 'manual' | 'webhook' = 'manual',
    relativePath?: string,
    scope?: WorkspaceScope,
  ) {
    // scope is omitted for the unauthenticated /trigger route - the presented
    // per-job trigger token (verified by the caller before reaching here) is
    // itself the authorization proof in that case.
    if (scope) await this.assertOwned(id, scope);
    const job = await this.prisma.syncJob.findUniqueOrThrow({ where: { id } });
    const safeRelativePath = this.resolveRelativePath(relativePath);
    const sourcePath = safeRelativePath ? this.joinPath(job.sourcePath, safeRelativePath) : job.sourcePath;
    const targetPath = safeRelativePath ? this.joinPath(job.targetPath, safeRelativePath) : job.targetPath;

    const run = await this.prisma.syncJobRun.create({
      data: {
        syncJobId: id,
        status: 'running',
        trigger,
      },
    });

    await this.prisma.syncJob.update({ where: { id }, data: { status: 'running', lastRunAt: new Date() } });

    if (job.nodeId && this.agentsService.isConnected(job.nodeId)) {
      this.agentsService.sendCommand(job.nodeId, {
        type: 'command.run_rsync',
        payload: {
          syncJobId: job.id,
          runId: run.id,
          sourcePath,
          targetPath,
          ...(job.sourceHost
            ? {
                sourceHost: job.sourceHost,
                ...(job.sourceUser ? { sourceUser: job.sourceUser } : {}),
                ...(job.sourceSshPort ? { sourceSshPort: job.sourceSshPort } : {}),
              }
            : {}),
        },
      });
    } else {
      const offlineMessage = this.normalizeFailureMessage('Agent offline - run simulated as failed');
      await this.completeRun(run.id, false, 0, offlineMessage);
      await this.createSyncJobFailureAlert({
        syncJobId: job.id,
        syncJobName: job.name,
        nodeId: job.nodeId,
        errorMessage: offlineMessage,
      });
    }

    await this.auditLogsService.log({
      // job.workspaceId, not scope?.workspaceId - scope is undefined for the
      // unauthenticated /trigger route (see triggerViaToken), but the job's
      // own workspace is always known once it's fetched above.
      workspaceId: job.workspaceId,
      actorUserId,
      action: 'sync_job.run',
      resourceType: 'sync_job_run',
      resourceId: run.id,
      details: { syncJobId: id, trigger, relativePath: safeRelativePath },
    });

    return this.prisma.syncJobRun.findUniqueOrThrow({ where: { id: run.id } });
  }

  /**
   * Entry point for POST /sync-jobs/:id/trigger - starts a run without a JWT
   * session, authenticated instead by the job's own trigger token (e.g. from
   * a qBittorrent "run on completion" script). Reuses run() so behavior
   * (command dispatch, audit log) stays identical to a manual run except for
   * the trigger label and the absence of an actorUserId.
   */
  async triggerViaToken(id: string, presentedToken: string | undefined, relativePath?: string) {
    if (!(await this.syncJobTriggerService.verify(id, presentedToken))) {
      throw new UnauthorizedException('invalid trigger token');
    }
    return this.run(id, undefined, 'webhook', relativePath);
  }

  async rotateTriggerToken(id: string, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertOwned(id, scope);
    await this.prisma.syncJob.findUniqueOrThrow({ where: { id } });
    const triggerToken = await this.syncJobTriggerService.rotate(id);

    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'sync_job.rotate_trigger_token',
      resourceType: 'sync_job',
      resourceId: id,
    });

    return { triggerToken };
  }

  async completeRun(id: string, success: boolean, bytesTransferred = 0, log?: string) {
    const run = await this.prisma.syncJobRun.update({
      where: { id },
      data: {
        status: success ? 'success' : 'failed',
        bytesTransferred,
        log,
        finishedAt: new Date(),
      },
      include: { syncJob: true },
    });

    await this.prisma.syncJob.update({
      where: { id: run.syncJobId },
      data: { status: success ? 'success' : 'failed', lastRunAt: new Date() },
    });

    return run;
  }

  async setRunStatusFromCommandResult(runId: string, success: boolean, message?: string) {
    return this.completeRun(runId, success, success ? 500000000 : 0, message);
  }

  async setStatus(syncJobId: string, status: SyncJobStatus) {
    return this.prisma.syncJob.update({ where: { id: syncJobId }, data: { status } });
  }
}
