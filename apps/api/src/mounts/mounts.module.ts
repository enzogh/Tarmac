import { forwardRef, Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AgentsModule } from '../agents/agents.module';
import { MountsController } from './mounts.controller';
import { MountsService } from './mounts.service';

@Module({
  imports: [AuditLogsModule, forwardRef(() => AgentsModule)],
  controllers: [MountsController],
  providers: [MountsService],
  exports: [MountsService],
})
export class MountsModule {}
