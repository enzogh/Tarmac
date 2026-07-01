import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MigrationsController } from './migrations.controller';
import { MigrationsService } from './migrations.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [MigrationsController],
  providers: [MigrationsService],
})
export class MigrationsModule {}
