import { forwardRef, Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { LiveModule } from '../live/live.module';
import { DnsController } from './dns.controller';
import { DnsDelegationCheckService } from './dns-delegation-check.service';
import { DnsDelegationService } from './dns-delegation.service';
import { DnsGroupsService } from './dns-groups.service';
import { DnsRecordsService } from './dns-records.service';
import { DnsZonesService } from './dns-zones.service';

@Module({
  imports: [AuditLogsModule, LiveModule, forwardRef(() => AgentsModule)],
  controllers: [DnsController],
  providers: [DnsGroupsService, DnsZonesService, DnsRecordsService, DnsDelegationService, DnsDelegationCheckService],
  exports: [DnsGroupsService, DnsZonesService, DnsRecordsService, DnsDelegationService, DnsDelegationCheckService],
})
export class DnsModule {}
