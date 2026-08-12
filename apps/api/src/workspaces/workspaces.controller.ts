import { Body, Controller, ForbiddenException, Get, Param, Post, Delete, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentWorkspace, WorkspaceGuard, WorkspaceScope } from '../auth/workspace.guard';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { WorkspacesService } from './workspaces.service';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string };
}

function assertPlatformAdmin(scope: WorkspaceScope) {
  if (!scope.isPlatformAdmin) {
    throw new ForbiddenException('Platform admin access required');
  }
}

@UseGuards(JwtAuthGuard, WorkspaceGuard)
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get()
  list(@CurrentWorkspace() scope: WorkspaceScope) {
    return this.workspacesService.list(scope);
  }

  // Workspace membership/roles are single-tier in v1 (member = full access) -
  // creating a workspace and managing its members is a platform-admin-only
  // action until an invite flow exists.
  @Post()
  create(@Body() dto: CreateWorkspaceDto, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    assertPlatformAdmin(scope);
    return this.workspacesService.create(dto, req.user?.userId);
  }

  @Get(':id/members')
  listMembers(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope) {
    assertPlatformAdmin(scope);
    return this.workspacesService.listMembers(id);
  }

  @Post(':id/members/:userId')
  addMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    assertPlatformAdmin(scope);
    return this.workspacesService.addMember(id, userId, req.user?.userId);
  }

  @Delete(':id/members/:userId')
  removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    assertPlatformAdmin(scope);
    return this.workspacesService.removeMember(id, userId, req.user?.userId);
  }
}
