import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentWorkspace, WorkspaceGuard, WorkspaceScope } from '../auth/workspace.guard';
import { API_KEY_SCOPES } from './api-key-token';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string };
}

// Session-only on purpose (JwtAuthGuard, not ApiKeyOrJwtGuard): an API key
// can never list, mint or revoke keys.
@UseGuards(JwtAuthGuard, WorkspaceGuard)
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Get('scopes')
  scopes() {
    return API_KEY_SCOPES;
  }

  @Get()
  list(@CurrentWorkspace() scope: WorkspaceScope) {
    return this.apiKeysService.list(scope);
  }

  @Post()
  create(@Body() dto: CreateApiKeyDto, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.apiKeysService.create(dto, scope, req.user?.userId);
  }

  @Post(':id/revoke')
  revoke(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.apiKeysService.revoke(id, scope, req.user?.userId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.apiKeysService.remove(id, scope, req.user?.userId);
  }
}
