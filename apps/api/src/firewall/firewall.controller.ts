import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiKeyOrJwtGuard, ApiKeyResource, RequireApiScope } from '../auth/api-key.guard';
import { CurrentWorkspace, WorkspaceGuard, WorkspaceScope } from '../auth/workspace.guard';
import {
  BulkFirewallNodesDto,
  CreateFirewallRuleDto,
  TestFirewallDto,
  UpdateFirewallRuleDto,
  UpdateFirewallSettingsDto,
} from './dto/firewall.dto';
import { FirewallService } from './firewall.service';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string };
}

// The firewall is part of the private network area: network:read to look,
// network:write to change rules and modes.
@UseGuards(ApiKeyOrJwtGuard, WorkspaceGuard)
@ApiKeyResource('network')
@Controller('firewall')
export class FirewallController {
  constructor(private readonly firewallService: FirewallService) {}

  @Get()
  overview(@CurrentWorkspace() scope: WorkspaceScope) {
    return this.firewallService.overview(scope);
  }

  @Get('events')
  events(
    @CurrentWorkspace() scope: WorkspaceScope,
    @Query() query: { hours?: string; scope?: string; verdict?: string; nodeId?: string },
  ) {
    return this.firewallService.events(scope, query);
  }

  // Read-only "would this connection get through?" - a POST for its body.
  @Post('test')
  @RequireApiScope('network:read')
  test(@Body() dto: TestFirewallDto, @CurrentWorkspace() scope: WorkspaceScope) {
    return this.firewallService.test(scope, dto);
  }

  @Patch('settings')
  updateSettings(@Body() dto: UpdateFirewallSettingsDto, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.firewallService.updateSettings(dto, { scope, userId: req.user?.userId });
  }

  @Patch('nodes')
  updateNodes(@Body() dto: BulkFirewallNodesDto, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.firewallService.updateNodesMode(dto, { scope, userId: req.user?.userId });
  }

  @Post('rules')
  createRule(@Body() dto: CreateFirewallRuleDto, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.firewallService.createRule(dto, { scope, userId: req.user?.userId });
  }

  @Patch('rules/:id')
  updateRule(
    @Param('id') id: string,
    @Body() dto: UpdateFirewallRuleDto,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.firewallService.updateRule(id, dto, { scope, userId: req.user?.userId });
  }

  @Delete('rules/:id')
  removeRule(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.firewallService.removeRule(id, { scope, userId: req.user?.userId });
  }
}
