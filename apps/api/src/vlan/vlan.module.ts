import { forwardRef, Module } from '@nestjs/common';
import { VlanService } from './vlan.service';
import { VlanController } from './vlan.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AgentsModule } from '../agents/agents.module';

@Module({
  imports: [PrismaModule, forwardRef(() => AgentsModule)],
  providers: [VlanService],
  controllers: [VlanController],
  exports: [VlanService],
})
export class VlanModule {}
