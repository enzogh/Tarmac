import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { CurrentWorkspace, WorkspaceGuard, WorkspaceScope } from '../auth/workspace.guard';
import { ApiKeyOrJwtGuard, ApiKeyResource } from '../auth/api-key.guard';
import { CompleteNodeOnboardingDto } from './dto/complete-node-onboarding.dto';
import { CreateNodeDto } from './dto/create-node.dto';
import { MuteNodeDto } from './dto/mute-node.dto';
import { StartNodeOnboardingDto } from './dto/start-node-onboarding.dto';
import { NodeOnboardingService } from './node-onboarding.service';
import { UpdateNodeDto } from './dto/update-node.dto';
import { NodesService } from './nodes.service';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string };
}

@UseGuards(ApiKeyOrJwtGuard, WorkspaceGuard)
@ApiKeyResource('nodes')
@Controller('nodes')
export class NodesController {
  constructor(
    private readonly nodesService: NodesService,
    private readonly nodeOnboardingService: NodeOnboardingService,
  ) {}

  @Get()
  list(@CurrentWorkspace() scope: WorkspaceScope) {
    return this.nodesService.list(scope);
  }

  @Post()
  create(@Body() dto: CreateNodeDto, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.nodesService.create(dto, scope, req.user?.userId);
  }

  @Post('onboarding/start')
  startOnboarding(
    @Body() dto: StartNodeOnboardingDto,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const rawProto = Array.isArray(forwardedProto)
      ? forwardedProto[0]
      : typeof forwardedProto === 'string'
        ? forwardedProto.split(',')[0]
        : req.protocol;
    const wsProto = rawProto === 'https' ? 'wss' : 'ws';
    const host = req.headers['x-forwarded-host'] ?? req.headers.host;
    const hostValue = Array.isArray(host) ? host[0] : host;
    const controlPlaneWs = dto.controlPlaneWs ?? (hostValue ? `${wsProto}://${hostValue}/agents-ws` : undefined);

    return this.nodeOnboardingService.startOnboarding(
      {
        ...dto,
        controlPlaneWs,
      },
      scope,
      req.user?.userId,
    );
  }

  @Post('onboarding/:id/install')
  completeOnboarding(@Param('id') id: string, @Body() dto: CompleteNodeOnboardingDto) {
    if (!dto.deployKeyConfirmed) {
      throw new BadRequestException('deployKeyConfirmed must be true');
    }
    return this.nodeOnboardingService.completeOnboarding(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateNodeDto,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.nodesService.update(id, dto, scope, req.user?.userId);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.nodesService.delete(id, scope, req.user?.userId);
  }

  @Post(':id/rotate-token')
  rotateAgentToken(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.nodesService.rotateAgentToken(id, scope, req.user?.userId);
  }

  @Post('rotate-tokens')
  rotateAllAgentTokens(@CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.nodesService.rotateAllAgentTokens(scope, req.user?.userId);
  }

  @Post(':id/mute')
  mute(
    @Param('id') id: string,
    @Body() dto: MuteNodeDto,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.nodesService.mute(id, dto.minutes, scope, req.user?.userId);
  }

  @Post(':id/unmute')
  unmute(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.nodesService.unmute(id, scope, req.user?.userId);
  }

  @Get('activity')
  activity(@Query('range') range = '1h', @CurrentWorkspace() scope: WorkspaceScope) {
    return this.nodesService.activity(range, scope);
  }

  // Before :id/metrics so "series" is never read as a node id.
  @Get('activity/series')
  activitySeries(@Query('range') range = '1h', @CurrentWorkspace() scope: WorkspaceScope) {
    return this.nodesService.activitySeries(range, scope);
  }

  @Get(':id/metrics')
  metrics(@Param('id') id: string, @Query('range') range = '1h', @CurrentWorkspace() scope: WorkspaceScope) {
    return this.nodesService.metrics(id, range, scope);
  }

  @Get(':id/disks/:diskName/smart-history')
  smartHistory(
    @Param('id') id: string,
    @Param('diskName') diskName: string,
    @CurrentWorkspace() scope: WorkspaceScope,
  ) {
    return this.nodesService.smartHistory(id, diskName, scope);
  }
}
