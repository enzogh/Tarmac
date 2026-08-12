import { forwardRef, Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { DnsController } from './dns.controller';
import { DnsService } from './dns.service';

@Module({
  imports: [AuditLogsModule, forwardRef(() => AgentsModule)],
  controllers: [DnsController],
  providers: [DnsService],
  exports: [DnsService],
})
export class DnsModule {}
