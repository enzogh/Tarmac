import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentWorkspace, WorkspaceGuard, WorkspaceScope } from '../auth/workspace.guard';
import { ApiKeyOrJwtGuard, ApiKeyResource } from '../auth/api-key.guard';
import { TopologyService } from './topology.service';

@UseGuards(ApiKeyOrJwtGuard, WorkspaceGuard)
@ApiKeyResource('nodes')
@Controller('topology')
export class TopologyController {
  constructor(private readonly topologyService: TopologyService) {}

  @Get()
  getOverview(@CurrentWorkspace() scope: WorkspaceScope) {
    return this.topologyService.getOverview(scope);
  }
}
