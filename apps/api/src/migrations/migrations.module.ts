import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MigrationsController } from './migrations.controller';
import { MigrationsService } from './migrations.service';

@Module({
  imports: [AuditLogsModule, AgentsModule],
  controllers: [MigrationsController],
  providers: [MigrationsService],
})
export class MigrationsModule {}
