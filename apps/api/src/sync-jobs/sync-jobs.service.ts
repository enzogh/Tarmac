import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma, SyncJobStatus } from '@prisma/client';
import { AgentsService } from '../agents/agents.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
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

  private async createSyncJobFailureAlert(params: {
    syncJobId: string;
    syncJobName: string;
    nodeId?: string | null;
    errorMessage: string;
  }) {
    const message = `Réplication "${params.syncJobName}" en échec : ${params.errorMessage}`;

    await this.prisma.alert.create({
      data: {
        nodeId: params.nodeId ?? null,
        severity: 'high',
        message,
      },
    });
  }

  list() {
    return this.prisma.syncJob.findMany({
      orderBy: { createdAt: 'desc' },
      include: { node: true, runs: { orderBy: { startedAt: 'desc' }, take: 5 } },
    });
  }

  listRuns(syncJobId: string) {
    return this.prisma.syncJobRun.findMany({ where: { syncJobId }, orderBy: { startedAt: 'desc' } });
  }

  listAllRuns() {
    return this.prisma.syncJobRun.findMany({
      orderBy: { startedAt: 'desc' },
      include: { syncJob: true },
      take: 300,
    });
  }

  async create(dto: CreateSyncJobDto, actorUserId?: string) {
    const triggerToken = this.syncJobTriggerService.generate();
    const created = await this.prisma.syncJob.create({
      data: { ...dto, triggerTokenHash: this.syncJobTriggerService.hash(triggerToken), triggerTokenRotatedAt: new Date() },
    });
    await this.auditLogsService.log({
      actorUserId,
      action: 'sync_job.create',
      resourceType: 'sync_job',
      resourceId: created.id,
      details: dto as unknown as Prisma.InputJsonValue,
    });
    // Only ever returned in plaintext at creation/rotation time; never persisted or logged.
    return { ...created, triggerToken };
  }

  async update(id: string, dto: UpdateSyncJobDto, actorUserId?: string) {
    const updated = await this.prisma.syncJob.update({ where: { id }, data: dto });
    await this.auditLogsService.log({
      actorUserId,
      action: 'sync_job.update',
      resourceType: 'sync_job',
      resourceId: id,
      details: dto as unknown as Prisma.InputJsonValue,
    });
    return updated;
  }

  async delete(id: string, actorUserId?: string) {
    const deleted = await this.prisma.syncJob.delete({ where: { id } });
    await this.auditLogsService.log({
      actorUserId,
      action: 'sync_job.delete',
      resourceType: 'sync_job',
      resourceId: id,
    });
    return deleted;
  }

  async run(id: string, actorUserId?: string, trigger: 'manual' | 'webhook' = 'manual') {
    const job = await this.prisma.syncJob.findUniqueOrThrow({ where: { id } });
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
          sourcePath: job.sourcePath,
          targetPath: job.targetPath,
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
      actorUserId,
      action: 'sync_job.run',
      resourceType: 'sync_job_run',
      resourceId: run.id,
      details: { syncJobId: id, trigger },
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
  async triggerViaToken(id: string, presentedToken: string | undefined) {
    if (!(await this.syncJobTriggerService.verify(id, presentedToken))) {
      throw new UnauthorizedException('invalid trigger token');
    }
    return this.run(id, undefined, 'webhook');
  }

  async rotateTriggerToken(id: string, actorUserId?: string) {
    await this.prisma.syncJob.findUniqueOrThrow({ where: { id } });
    const triggerToken = await this.syncJobTriggerService.rotate(id);

    await this.auditLogsService.log({
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
