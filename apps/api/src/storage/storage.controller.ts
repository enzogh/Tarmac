import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentWorkspace, WorkspaceGuard, WorkspaceScope } from '../auth/workspace.guard';
import { ApiKeyOrJwtGuard, ApiKeyResource } from '../auth/api-key.guard';
import { StorageService } from './storage.service';

@UseGuards(ApiKeyOrJwtGuard, WorkspaceGuard)
@ApiKeyResource('storage')
@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Get('forecast')
  forecast(@CurrentWorkspace() scope: WorkspaceScope, @Query('nodeId') nodeId?: string) {
    return this.storageService.forecast(nodeId, scope);
  }

  @Get('overview')
  overview(@CurrentWorkspace() scope: WorkspaceScope, @Query('nodeId') nodeId?: string) {
    return this.storageService.overview(nodeId, scope);
  }
}
