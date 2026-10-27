import { forwardRef, Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { LiveModule } from '../live/live.module';
import { DnsController } from './dns.controller';
import { DnsDelegationCheckService } from './dns-delegation-check.service';
import { DnsDelegationService } from './dns-delegation.service';
import { DnsGroupsService } from './dns-groups.service';
import { DnsRecordsService } from './dns-records.service';
import { DnsSyncCheckService } from './dns-sync-check.service';
import { DnsZonesService } from './dns-zones.service';
import { InternalDnsService } from './internal-dns.service';

@Module({
  imports: [AuditLogsModule, LiveModule, forwardRef(() => AgentsModule)],
  controllers: [DnsController],
  providers: [
    DnsGroupsService,
    DnsZonesService,
    DnsRecordsService,
    DnsDelegationService,
    DnsDelegationCheckService,
    DnsSyncCheckService,
    InternalDnsService,
  ],
  exports: [
    DnsGroupsService,
    DnsZonesService,
    DnsRecordsService,
    DnsDelegationService,
    DnsDelegationCheckService,
    InternalDnsService,
  ],
})
export class DnsModule {}
