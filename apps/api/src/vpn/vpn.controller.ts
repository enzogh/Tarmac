import { Body, Controller, Delete, Get, Param, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiKeyOrJwtGuard, ApiKeyResource, RequireApiScope } from '../auth/api-key.guard';
import { CurrentWorkspace, WorkspaceGuard, WorkspaceScope } from '../auth/workspace.guard';
import { BulkVpnProfilesDto } from './dto/bulk-vpn-profiles.dto';
import { CreateVpnProfileDto } from './dto/create-vpn-profile.dto';
import { RotateVpnKeysDto } from './dto/rotate-keys.dto';
import { SwitchVpnExitDto } from './dto/switch-exit.dto';
import { UpdateVpnProfileDto } from './dto/update-vpn-profile.dto';
import { VpnService } from './vpn.service';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string };
}

// Reachable with a user session or a workspace API key (Authorization:
// Bearer tmk_...). Config downloads carry the client's private key, so they
// need vpn:write like every other call that hands out credentials.
@UseGuards(ApiKeyOrJwtGuard, WorkspaceGuard)
@ApiKeyResource('vpn')
@Controller('vpn')
export class VpnController {
  constructor(private readonly vpnService: VpnService) {}

  @Get('gateways')
  @RequireApiScope('vpn:read')
  gateways(@CurrentWorkspace() scope: WorkspaceScope) {
    return this.vpnService.listGateways(scope);
  }

  @Get('profiles')
  @RequireApiScope('vpn:read')
  list(@CurrentWorkspace() scope: WorkspaceScope) {
    return this.vpnService.list(scope);
  }

  @Get('profiles/:id')
  @RequireApiScope('vpn:read')
  get(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope) {
    return this.vpnService.get(id, scope);
  }

  @Post('profiles')
  @RequireApiScope('vpn:write')
  create(@Body() dto: CreateVpnProfileDto, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.vpnService.create(dto, { scope, userId: req.user?.userId });
  }

  @Post('profiles/bulk')
  @RequireApiScope('vpn:write')
  bulk(@Body() dto: BulkVpnProfilesDto, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.vpnService.bulk(dto, { scope, userId: req.user?.userId });
  }

  @Patch('profiles/:id')
  @RequireApiScope('vpn:write')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateVpnProfileDto,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.vpnService.update(id, dto, { scope, userId: req.user?.userId });
  }

  @Post('profiles/:id/exit')
  @RequireApiScope('vpn:write')
  switchExit(
    @Param('id') id: string,
    @Body() dto: SwitchVpnExitDto,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.vpnService.switchExit(id, dto.exitNodeId, { scope, userId: req.user?.userId });
  }

  @Post('profiles/:id/rotate-keys')
  @RequireApiScope('vpn:write')
  rotateKeys(
    @Param('id') id: string,
    @Body() dto: RotateVpnKeysDto,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.vpnService.rotateKeys(id, dto, { scope, userId: req.user?.userId });
  }

  @Delete('profiles/:id')
  @RequireApiScope('vpn:write')
  remove(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.vpnService.remove(id, { scope, userId: req.user?.userId });
  }

  @Get('profiles/:id/config')
  @RequireApiScope('vpn:write')
  config(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope) {
    return this.vpnService.getConfig(id, scope);
  }

  // Same config as a ready-to-import file, e.g. `curl -OJ`.
  @Get('profiles/:id/config.conf')
  @RequireApiScope('vpn:write')
  async configFile(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Res() res: Response) {
    const { filename, config } = await this.vpnService.getConfig(id, scope);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(config);
  }
}
