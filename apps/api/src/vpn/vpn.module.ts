import { forwardRef, Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { LiveModule } from '../live/live.module';
import { VlanModule } from '../vlan/vlan.module';
import { VpnController } from './vpn.controller';
import { VpnService } from './vpn.service';

@Module({
  imports: [AuditLogsModule, LiveModule, forwardRef(() => VlanModule), forwardRef(() => AgentsModule)],
  controllers: [VpnController],
  providers: [VpnService],
  exports: [VpnService],
})
export class VpnModule {}
