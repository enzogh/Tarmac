import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { CurrentWorkspace, WorkspaceGuard, WorkspaceScope } from '../auth/workspace.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AgentTokenService } from './agent-token.service';
import { AgentsService } from './agents.service';

type AgentUninstallRequest = {
  nodeId?: string;
  token?: string;
};

@Controller('agents')
export class AgentsController {
  constructor(
    private readonly agentsService: AgentsService,
    private readonly agentTokenService: AgentTokenService,
    private readonly prisma: PrismaService,
  ) {}

  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @Post(':nodeId/update')
  async updateAgent(
    @Param('nodeId') nodeId: string,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Body() body?: { ref?: string; repoUrl?: string; serviceName?: string },
  ) {
    const node = await this.prisma.node.findFirst({ where: { id: nodeId, workspaceId: scope.workspaceId }, select: { id: true } });
    if (!node) throw new ForbiddenException('Node not in your workspace');
    const requestedRef = body?.ref?.trim();
    const requestedRepo = body?.repoUrl?.trim();
    const requestedService = body?.serviceName?.trim();

    if (requestedRef !== undefined && requestedRef.length === 0) {
      throw new BadRequestException('ref cannot be empty');
    }
    if (requestedRepo !== undefined && requestedRepo.length === 0) {
      throw new BadRequestException('repoUrl cannot be empty');
    }
    if (requestedService !== undefined && requestedService.length === 0) {
      throw new BadRequestException('serviceName cannot be empty');
    }

    return this.agentsService.triggerAgentUpdate(nodeId, {
      ref: requestedRef,
      repoUrl: requestedRepo,
      serviceName: requestedService,
    });
  }

  @Post('uninstall')
  @HttpCode(HttpStatus.NO_CONTENT)
  async uninstall(@Body() body: AgentUninstallRequest) {
    if (!body.nodeId || !body.token || !(await this.agentTokenService.verify(body.nodeId, body.token))) {
      throw new UnauthorizedException('invalid agent uninstall token');
    }
    await this.agentsService.handleAgentUninstall(body.nodeId);
  }
}
