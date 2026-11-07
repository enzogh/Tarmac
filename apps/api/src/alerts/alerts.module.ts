import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { VlanModule } from '../vlan/vlan.module';
import { AlertSupervisorService } from './alert-supervisor.service';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';

@Module({
  imports: [AuditLogsModule, VlanModule],
  controllers: [AlertsController],
  providers: [AlertsService, AlertSupervisorService],
})
export class AlertsModule {}
