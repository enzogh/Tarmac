import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { SyncJobsController } from './sync-jobs.controller';
import { SyncJobsService } from './sync-jobs.service';

@Module({
  imports: [AgentsModule, AuditLogsModule],
  controllers: [SyncJobsController],
  providers: [SyncJobsService],
  exports: [SyncJobsService],
})
export class SyncJobsModule {}
