import { forwardRef, Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DnsController } from './dns.controller';
import { DnsDelegationService } from './dns-delegation.service';
import { DnsGroupsService } from './dns-groups.service';
import { DnsRecordsService } from './dns-records.service';
import { DnsZonesService } from './dns-zones.service';

@Module({
  imports: [AuditLogsModule, forwardRef(() => AgentsModule)],
  controllers: [DnsController],
  providers: [DnsGroupsService, DnsZonesService, DnsRecordsService, DnsDelegationService],
  exports: [DnsGroupsService, DnsZonesService, DnsRecordsService, DnsDelegationService],
})
export class DnsModule {}
