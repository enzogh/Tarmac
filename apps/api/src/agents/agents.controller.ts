import { Body, Controller, HttpCode, HttpStatus, Post, UnauthorizedException } from '@nestjs/common';
import { AgentsService } from './agents.service';

type AgentUninstallRequest = {
  nodeId?: string;
  token?: string;
};

@Controller('agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Post('uninstall')
  @HttpCode(HttpStatus.NO_CONTENT)
  async uninstall(@Body() body: AgentUninstallRequest) {
    const expected = process.env.AGENT_SHARED_TOKEN ?? 'agent-secret';
    if (!body.nodeId || body.token !== expected) {
      throw new UnauthorizedException('invalid agent uninstall token');
    }
    await this.agentsService.handleAgentUninstall(body.nodeId);
  }
}
