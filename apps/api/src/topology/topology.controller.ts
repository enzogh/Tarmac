import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TopologyService } from './topology.service';

@UseGuards(JwtAuthGuard)
@Controller('topology')
export class TopologyController {
  constructor(private readonly topologyService: TopologyService) {}

  @Get()
  getOverview() {
    return this.topologyService.getOverview();
  }
}
