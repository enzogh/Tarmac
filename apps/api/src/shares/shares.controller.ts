import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { CurrentWorkspace, WorkspaceGuard, WorkspaceScope } from '../auth/workspace.guard';
import { ApiKeyOrJwtGuard, ApiKeyResource } from '../auth/api-key.guard';
import { CreateShareDto } from './dto/create-share.dto';
import { UpdateShareClientDto } from './dto/update-share-client.dto';
import { UpdateShareDto } from './dto/update-share.dto';
import { UpsertShareClientDto } from './dto/upsert-share-client.dto';
import { SharesService } from './shares.service';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string };
}

@UseGuards(ApiKeyOrJwtGuard, WorkspaceGuard)
@ApiKeyResource('storage')
@Controller('shares')
export class SharesController {
  constructor(private readonly sharesService: SharesService) {}

  @Get()
  list(@CurrentWorkspace() scope: WorkspaceScope) {
    return this.sharesService.list(scope);
  }

  @Post()
  create(@Body() dto: CreateShareDto, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.sharesService.create(dto, scope, req.user?.userId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateShareDto,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.sharesService.update(id, dto, scope, req.user?.userId);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.sharesService.delete(id, scope, req.user?.userId);
  }

  @Post(':id/reapply')
  reapply(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.sharesService.reapply(id, scope, req.user?.userId);
  }

  @Get(':id/clients')
  listClients(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope) {
    return this.sharesService.listClients(id, scope);
  }

  @Post(':id/clients')
  addClient(
    @Param('id') id: string,
    @Body() dto: UpsertShareClientDto,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.sharesService.upsertClient(id, dto.clientId, dto.access, scope, req.user?.userId);
  }

  @Patch(':id/clients/:clientId')
  updateClient(
    @Param('id') id: string,
    @Param('clientId') clientId: string,
    @Body() dto: UpdateShareClientDto,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.sharesService.upsertClient(id, clientId, dto.access, scope, req.user?.userId);
  }

  @Delete(':id/clients/:clientId')
  removeClient(
    @Param('id') id: string,
    @Param('clientId') clientId: string,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.sharesService.removeClient(id, clientId, scope, req.user?.userId);
  }
}
