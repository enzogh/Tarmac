import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GithubDeployKeysService } from '../github/github-deploy-keys.service';
import { AdminService } from './admin.service';
import { ConfigureGithubDto, TransferWorkspaceDto, UpdateAdminSettingsDto } from './dto/admin-settings.dto';
import { UpdateUserLimitDto } from './dto/update-user-limit.dto';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string };
}

@UseGuards(JwtAuthGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly githubDeployKeys: GithubDeployKeysService,
  ) {}

  // GitHub deploy keys of the nodes (see GithubDeployKeysService).
  @Get('github')
  async getGithub(@Req() req: AuthenticatedRequest) {
    await this.adminService.assertSuperuser(req.user?.userId);
    return this.githubDeployKeys.sync();
  }

  @Put('github')
  async configureGithub(@Body() dto: ConfigureGithubDto, @Req() req: AuthenticatedRequest) {
    await this.adminService.assertSuperuser(req.user?.userId);
    return this.githubDeployKeys.configure(dto, req.user?.userId);
  }

  @Delete('github')
  async disconnectGithub(@Req() req: AuthenticatedRequest) {
    await this.adminService.assertSuperuser(req.user?.userId);
    return this.githubDeployKeys.disconnect(req.user?.userId);
  }

  @Delete('github/keys/:id')
  async deleteGithubKey(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.adminService.assertSuperuser(req.user?.userId);
    return this.githubDeployKeys.deleteOrphanKey(id, req.user?.userId);
  }

  @Get('users')
  async listUsers(@Req() req: AuthenticatedRequest) {
    await this.adminService.assertSuperuser(req.user?.userId);
    return this.adminService.listUsers();
  }

  @Get('users/:id')
  async getUser(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.adminService.assertSuperuser(req.user?.userId);
    return this.adminService.getUser(id);
  }

  @Patch('users/:id')
  async updateUser(@Param('id') id: string, @Body() dto: UpdateUserLimitDto, @Req() req: AuthenticatedRequest) {
    await this.adminService.assertSuperuser(req.user?.userId);
    return this.adminService.updateUser(id, dto, req.user?.userId);
  }

  @Get('settings')
  async getSettings(@Req() req: AuthenticatedRequest) {
    await this.adminService.assertSuperuser(req.user?.userId);
    return this.adminService.getSettings();
  }

  @Patch('settings')
  async updateSettings(@Body() dto: UpdateAdminSettingsDto, @Req() req: AuthenticatedRequest) {
    await this.adminService.assertSuperuser(req.user?.userId);
    return this.adminService.updateSettings(dto, req.user?.userId);
  }

  @Post('access-sync')
  async runAccessSync(@Req() req: AuthenticatedRequest) {
    await this.adminService.assertSuperuser(req.user?.userId);
    return this.adminService.runAccessSync();
  }

  @Get('email-templates')
  async listEmailTemplates(@Req() req: AuthenticatedRequest) {
    await this.adminService.assertSuperuser(req.user?.userId);
    return this.adminService.listEmailTemplates(req.user?.userId);
  }

  @Post('email-templates/:id/test')
  async sendTestEmail(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.adminService.assertSuperuser(req.user?.userId);
    return this.adminService.sendTestEmail(id, req.user?.userId);
  }

  @Post('workspaces/:id/transfer')
  async transferWorkspace(@Param('id') id: string, @Body() dto: TransferWorkspaceDto, @Req() req: AuthenticatedRequest) {
    await this.adminService.assertSuperuser(req.user?.userId);
    return this.adminService.transferWorkspace(id, dto.userId, req.user?.userId);
  }
}
