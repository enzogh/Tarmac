import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MountsModule } from '../mounts/mounts.module';
import { PoolsModule } from '../pools/pools.module';
import { SharesModule } from '../shares/shares.module';
import { VlanModule } from '../vlan/vlan.module';
import { AgentsGateway } from './agents.gateway';
import { AgentsService } from './agents.service';
import { AgentsWsServer } from './agents.ws';

@Module({
  imports: [ScheduleModule.forRoot(), SharesModule, MountsModule, PoolsModule, VlanModule],
  providers: [AgentsGateway, AgentsService, AgentsWsServer],
  exports: [AgentsService],
})
export class AgentsModule {}
