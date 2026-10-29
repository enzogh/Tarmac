import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Delete, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AllowNoWorkspace, CurrentWorkspace, WorkspaceGuard, WorkspaceScope } from '../auth/workspace.guard';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { CustomRoleDto, InviteMemberDto, MemberAccessDto, TransferOwnershipDto, UpdateCustomRoleDto } from './dto/member-access.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
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
  @AllowNoWorkspace()
  list(@CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.workspacesService.list(scope, req.user?.userId);
  }

  // Platform admins create freely; members of the Authentik access group
  // (User.canCreateWorkspaces) up to WORKSPACE_CREATION_LIMIT. The creator
  // becomes owner and then manages members and their roles.
  @Post()
  @AllowNoWorkspace()
  async create(@Body() dto: CreateWorkspaceDto, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    if (!scope.isPlatformAdmin) await this.workspacesService.assertCreationQuota(req.user?.userId);
    return this.workspacesService.create(dto, req.user?.userId);
  }

  // name, slug, weekly report and ssoGroupClaim (the Authentik group that
  // auto-grants membership on SSO login) only - see WorkspacesService.update.
  // Owner-or-platform-admin, and ssoGroupClaim platform-admin only, both
  // enforced inside the service.
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateWorkspaceDto,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.workspacesService.update(id, dto, scope, req.user?.userId);
  }

  // Lets a platform admin find a userId to pass to addMember() below -
  // there's no dedicated users module/list endpoint anywhere else yet.
  @Get('users')
  listAllUsers(@CurrentWorkspace() scope: WorkspaceScope) {
    assertPlatformAdmin(scope);
    return this.workspacesService.listAllUsers();
  }

  // Platform-admin-only listMembers/removeMember gating is gone - workspace
  // owners now manage their own workspace's members too, enforced inside
  // WorkspacesService.assertCanManageMembers (workspace-scoped, unlike
  // assertPlatformAdmin above which is platform-wide).
  @Get(':id/members')
  listMembers(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.workspacesService.listMembers(id, scope, req.user?.userId);
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

  // Adds an existing account, or emails an invitation to an address that
  // has never signed in - see WorkspacesService.inviteByEmail.
  @Post(':id/invite')
  invite(
    @Param('id') id: string,
    @Body() dto: InviteMemberDto,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.workspacesService.inviteByEmail(id, dto, scope, req.user?.userId);
  }

  // Role (owner/member) and, for members, which areas they read or change.
  @Patch(':id/members/:userId')
  updateMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: MemberAccessDto,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.workspacesService.updateMember(id, userId, dto, scope, req.user?.userId);
  }

  @Delete(':id/members/:userId')
  removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.workspacesService.removeMember(id, userId, scope, req.user?.userId);
  }

  @Get(':id/invitations')
  listInvitations(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.workspacesService.listInvitations(id, scope, req.user?.userId);
  }

  @Post(':id/invitations/:invitationId/resend')
  resendInvitation(
    @Param('id') id: string,
    @Param('invitationId') invitationId: string,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.workspacesService.resendInvitation(id, invitationId, scope, req.user?.userId);
  }

  @Delete(':id/invitations/:invitationId')
  revokeInvitation(
    @Param('id') id: string,
    @Param('invitationId') invitationId: string,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.workspacesService.revokeInvitation(id, invitationId, scope, req.user?.userId);
  }

  // Named permission sets of this workspace (administrators only).
  @Get(':id/roles')
  listRoles(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.workspacesService.listCustomRoles(id, scope, req.user?.userId);
  }

  @Post(':id/roles')
  createRole(@Param('id') id: string, @Body() dto: CustomRoleDto, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.workspacesService.createCustomRole(id, dto, scope, req.user?.userId);
  }

  @Patch(':id/roles/:roleId')
  updateRole(
    @Param('id') id: string,
    @Param('roleId') roleId: string,
    @Body() dto: UpdateCustomRoleDto,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.workspacesService.updateCustomRole(id, roleId, dto, scope, req.user?.userId);
  }

  @Delete(':id/roles/:roleId')
  deleteRole(@Param('id') id: string, @Param('roleId') roleId: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.workspacesService.deleteCustomRole(id, roleId, scope, req.user?.userId);
  }

  // The current owner (or a platform admin) hands the workspace to another
  // member - see WorkspacesService.transferOwnership.
  @Post(':id/transfer')
  transfer(
    @Param('id') id: string,
    @Body() dto: TransferOwnershipDto,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.workspacesService.transferOwnership(id, dto.userId, scope, req.user?.userId, dto.keepAdmin ?? true);
  }

  // Owner-or-platform-admin, and only once genuinely empty - see
  // WorkspacesService.deleteWorkspace.
  @Delete(':id')
  deleteWorkspace(
    @Param('id') id: string,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.workspacesService.deleteWorkspace(id, scope, req.user?.userId);
  }
}
