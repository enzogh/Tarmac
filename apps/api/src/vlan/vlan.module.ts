import { forwardRef, Module } from '@nestjs/common';
import { VlanService } from './vlan.service';
import { VlanController } from './vlan.controller';
import { LinkCaptureService } from './link-capture.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AgentsModule } from '../agents/agents.module';

@Module({
  imports: [PrismaModule, forwardRef(() => AgentsModule)],
  providers: [VlanService, LinkCaptureService],
  controllers: [VlanController],
  exports: [VlanService],
})
export class VlanModule {}
