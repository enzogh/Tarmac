import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { NodeOnboardingService } from './node-onboarding.service';
import { NodesController } from './nodes.controller';
import { NodesService } from './nodes.service';

@Module({
  imports: [AuditLogsModule, ConfigModule],
  controllers: [NodesController],
  providers: [NodesService, NodeOnboardingService],
  exports: [NodesService],
})
export class NodesModule {}
