import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AlertRulesController } from './alert-rules.controller';
import { AlertRulesEvaluatorService } from './alert-rules-evaluator.service';
import { AlertRulesService } from './alert-rules.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [AlertRulesController],
  providers: [AlertRulesService, AlertRulesEvaluatorService],
})
export class AlertRulesModule {}
