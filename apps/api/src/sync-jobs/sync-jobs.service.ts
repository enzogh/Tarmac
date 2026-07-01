import { Injectable } from '@nestjs/common';
import { Prisma, SyncJobStatus } from '@prisma/client';
import { AgentsService } from '../agents/agents.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSyncJobDto } from './dto/create-sync-job.dto';
import { UpdateSyncJobDto } from './dto/update-sync-job.dto';

@Injectable()
export class SyncJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agentsService: AgentsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

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
    const created = await this.prisma.syncJob.create({ data: dto });
    await this.auditLogsService.log({
      actorUserId,
      action: 'sync_job.create',
      resourceType: 'sync_job',
      resourceId: created.id,
      details: dto as unknown as Prisma.InputJsonValue,
    });
    return created;
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

  async run(id: string, actorUserId?: string) {
    const job = await this.prisma.syncJob.findUniqueOrThrow({ where: { id } });
    const run = await this.prisma.syncJobRun.create({
      data: {
        syncJobId: id,
        status: 'running',
        trigger: 'manual',
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
        },
      });
    } else {
      await this.completeRun(run.id, false, 0, 'Agent offline - run simulated as failed');
    }

    await this.auditLogsService.log({
      actorUserId,
      action: 'sync_job.run',
      resourceType: 'sync_job_run',
      resourceId: run.id,
      details: { syncJobId: id },
    });

    return this.prisma.syncJobRun.findUniqueOrThrow({ where: { id: run.id } });
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
