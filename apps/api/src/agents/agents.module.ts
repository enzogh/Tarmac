import { forwardRef, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AgentLogsModule } from '../agent-logs/agent-logs.module';
import { MigrationsModule } from '../migrations/migrations.module';
import { MountsModule } from '../mounts/mounts.module';
import { PoolsModule } from '../pools/pools.module';
import { SharesModule } from '../shares/shares.module';
import { VlanModule } from '../vlan/vlan.module';
import { AgentTokenService } from './agent-token.service';
import { AgentsController } from './agents.controller';
import { AgentsGateway } from './agents.gateway';
import { AgentsService } from './agents.service';
import { AgentsWsServer } from './agents.ws';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AgentLogsModule,
    SharesModule,
    forwardRef(() => MountsModule),
    forwardRef(() => MigrationsModule),
    PoolsModule,
    forwardRef(() => VlanModule),
  ],
  controllers: [AgentsController],
  providers: [AgentsGateway, AgentsService, AgentsWsServer, AgentTokenService],
  exports: [AgentsService, AgentTokenService],
})
export class AgentsModule {}
