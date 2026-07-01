import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { NotificationChannelsController } from './notification-channels.controller';
import { NotificationChannelsService } from './notification-channels.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [NotificationChannelsController],
  providers: [NotificationChannelsService],
})
export class NotificationChannelsModule {}
