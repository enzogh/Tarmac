import { Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiKeyOrJwtGuard, ApiKeyResource, RequireApiScope } from '../auth/api-key.guard';
import { CurrentWorkspace, WorkspaceGuard, WorkspaceScope } from '../auth/workspace.guard';
import { HistoryService } from './history.service';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string };
}

@UseGuards(ApiKeyOrJwtGuard, WorkspaceGuard)
@ApiKeyResource('logs')
@Controller('history')
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  // Reading the Journal is enough to reach it; the write permission on the
  // restored resource (firewall, dns) is checked by the service.
  @Post(':auditLogId/restore')
  @RequireApiScope('logs:read')
  restore(@Param('auditLogId') auditLogId: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.historyService.restore(auditLogId, scope, req.user?.userId);
  }
}
