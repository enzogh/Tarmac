import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { SyncJobTriggerService } from './sync-job-trigger.service';
import { SyncJobsController } from './sync-jobs.controller';
import { SyncJobsService } from './sync-jobs.service';

@Module({
  imports: [AgentsModule, AuditLogsModule],
  controllers: [SyncJobsController],
  providers: [SyncJobsService, SyncJobTriggerService],
  exports: [SyncJobsService],
})
export class SyncJobsModule {}
