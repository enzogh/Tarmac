import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MountsController } from './mounts.controller';
import { MountsService } from './mounts.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [MountsController],
  providers: [MountsService],
  exports: [MountsService],
})
export class MountsModule {}
