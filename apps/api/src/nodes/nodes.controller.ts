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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompleteNodeOnboardingDto } from './dto/complete-node-onboarding.dto';
import { CreateNodeDto } from './dto/create-node.dto';
import { StartNodeOnboardingDto } from './dto/start-node-onboarding.dto';
import { NodeOnboardingService } from './node-onboarding.service';
import { UpdateNodeDto } from './dto/update-node.dto';
import { NodesService } from './nodes.service';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string };
}

@UseGuards(JwtAuthGuard)
@Controller('nodes')
export class NodesController {
  constructor(
    private readonly nodesService: NodesService,
    private readonly nodeOnboardingService: NodeOnboardingService,
  ) {}

  @Get()
  list() {
    return this.nodesService.list();
  }

  @Post()
  create(@Body() dto: CreateNodeDto, @Req() req: AuthenticatedRequest) {
    return this.nodesService.create(dto, req.user?.userId);
  }

  @Post('onboarding/start')
  startOnboarding(@Body() dto: StartNodeOnboardingDto, @Req() req: AuthenticatedRequest) {
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
  update(@Param('id') id: string, @Body() dto: UpdateNodeDto, @Req() req: AuthenticatedRequest) {
    return this.nodesService.update(id, dto, req.user?.userId);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.nodesService.delete(id, req.user?.userId);
  }

  @Post(':id/rotate-token')
  rotateAgentToken(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.nodesService.rotateAgentToken(id, req.user?.userId);
  }

  @Post('rotate-tokens')
  rotateAllAgentTokens(@Req() req: AuthenticatedRequest) {
    return this.nodesService.rotateAllAgentTokens(req.user?.userId);
  }

  @Get('activity')
  activity(@Query('range') range = '1h') {
    return this.nodesService.activity(range);
  }

  @Get(':id/metrics')
  metrics(@Param('id') id: string, @Query('range') range = '1h') {
    return this.nodesService.metrics(id, range);
  }
}
