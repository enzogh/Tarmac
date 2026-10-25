import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CurrentWorkspace, WorkspaceGuard, WorkspaceScope } from '../auth/workspace.guard';
import { ApiKeyOrJwtGuard, ApiKeyResource } from '../auth/api-key.guard';
import { CreatePoolDto } from './dto/create-pool.dto';
import { UpdatePoolDto } from './dto/update-pool.dto';
import { UpsertPoolMemberDto } from './dto/upsert-pool-member.dto';
import { PoolsService } from './pools.service';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string };
}

@UseGuards(ApiKeyOrJwtGuard, WorkspaceGuard)
@ApiKeyResource('storage')
@Controller('pools')
export class PoolsController {
  constructor(private readonly poolsService: PoolsService) {}

  @Get()
  list(@CurrentWorkspace() scope: WorkspaceScope) {
    return this.poolsService.list(scope);
  }

  @Post()
  create(@Body() dto: CreatePoolDto, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.poolsService.create(dto, scope, req.user?.userId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePoolDto,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.poolsService.update(id, dto, scope, req.user?.userId);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.poolsService.delete(id, scope, req.user?.userId);
  }

  @Post(':id/members')
  addMember(
    @Param('id') id: string,
    @Body() dto: UpsertPoolMemberDto,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.poolsService.upsertMember(id, dto, scope, req.user?.userId);
  }

  @Patch(':id/members/:nodeId')
  updateMember(
    @Param('id') id: string,
    @Param('nodeId') nodeId: string,
    @Body() dto: Omit<UpsertPoolMemberDto, 'nodeId'>,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.poolsService.upsertMember(
      id,
      { nodeId, role: dto.role, status: dto.status },
      scope,
      req.user?.userId,
    );
  }

  @Delete(':id/members/:nodeId')
  removeMember(
    @Param('id') id: string,
    @Param('nodeId') nodeId: string,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.poolsService.removeMember(id, nodeId, scope, req.user?.userId);
  }
}
