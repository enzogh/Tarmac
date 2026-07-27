import { Module } from '@nestjs/common';
import { LiveModule } from '../live/live.module';
import { AgentLogsController } from './agent-logs.controller';
import { AgentLogsService } from './agent-logs.service';

@Module({
  imports: [LiveModule],
  controllers: [AgentLogsController],
  providers: [AgentLogsService],
  exports: [AgentLogsService],
})
export class AgentLogsModule {}
