import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentWorkspace, WorkspaceGuard, WorkspaceScope } from '../auth/workspace.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TopologyService } from './topology.service';

@UseGuards(JwtAuthGuard, WorkspaceGuard)
@Controller('topology')
export class TopologyController {
  constructor(private readonly topologyService: TopologyService) {}

  @Get()
  getOverview(@CurrentWorkspace() scope: WorkspaceScope) {
    return this.topologyService.getOverview(scope);
  }
}
