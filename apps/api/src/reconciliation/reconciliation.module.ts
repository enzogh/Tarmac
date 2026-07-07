import { Module } from '@nestjs/common';
import { AgentsModule } from '../agents/agents.module';
import { MountsModule } from '../mounts/mounts.module';
import { PoolsModule } from '../pools/pools.module';
import { SharesModule } from '../shares/shares.module';
import { VlanModule } from '../vlan/vlan.module';
import { ReconciliationService } from './reconciliation.service';

@Module({
  imports: [SharesModule, MountsModule, PoolsModule, AgentsModule, VlanModule],
  providers: [ReconciliationService],
})
export class ReconciliationModule {}
