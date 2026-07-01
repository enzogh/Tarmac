import { Module } from '@nestjs/common';
import { VlanService } from './vlan.service';
import { VlanController } from './vlan.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [VlanService],
  controllers: [VlanController],
  exports: [VlanService],
})
export class VlanModule {}
