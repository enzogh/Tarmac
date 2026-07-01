import { Module } from '@nestjs/common';
import { MountsModule } from '../mounts/mounts.module';
import { PoolsModule } from '../pools/pools.module';
import { SharesModule } from '../shares/shares.module';
import { AgentsGateway } from './agents.gateway';
import { AgentsService } from './agents.service';
import { AgentsWsServer } from './agents.ws';

@Module({
  imports: [SharesModule, MountsModule, PoolsModule],
  providers: [AgentsGateway, AgentsService, AgentsWsServer],
  exports: [AgentsService],
})
export class AgentsModule {}
