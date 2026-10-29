import { Module } from '@nestjs/common';
import { DnsModule } from '../dns/dns.module';
import { FirewallModule } from '../firewall/firewall.module';
import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';

@Module({
  imports: [FirewallModule, DnsModule],
  controllers: [HistoryController],
  providers: [HistoryService],
})
export class HistoryModule {}
