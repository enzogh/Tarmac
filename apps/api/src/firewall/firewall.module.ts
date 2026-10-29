import { forwardRef, Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { LiveModule } from '../live/live.module';
import { FirewallController } from './firewall.controller';
import { FirewallService } from './firewall.service';

@Module({
  imports: [AuditLogsModule, LiveModule, forwardRef(() => AgentsModule)],
  controllers: [FirewallController],
  providers: [FirewallService],
  exports: [FirewallService],
})
export class FirewallModule {}
