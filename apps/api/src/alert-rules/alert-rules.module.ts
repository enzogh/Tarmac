import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AlertRulesController } from './alert-rules.controller';
import { AlertRulesService } from './alert-rules.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [AlertRulesController],
  providers: [AlertRulesService],
})
export class AlertRulesModule {}
