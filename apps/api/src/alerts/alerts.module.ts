import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [AlertsController],
  providers: [AlertsService],
})
export class AlertsModule {}
