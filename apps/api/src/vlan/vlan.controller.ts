import { Controller, Get, Post, Param, Body, Query, UseGuards, HttpException, HttpStatus, Logger, Inject, forwardRef } from '@nestjs/common';
import { VlanService } from './vlan.service';
import { AgentsService } from '../agents/agents.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('vlan')
@UseGuards(AuthGuard('jwt'))
export class VlanController {
  private readonly logger = new Logger(VlanController.name);

  constructor(
    private vlanService: VlanService,
    @Inject(forwardRef(() => AgentsService)) private agentsService: AgentsService,
  ) {}

  @Get()
  async getAllVlans() {
    try {
      // Try to get or create default VLAN on first request
      const vlan = await this.vlanService.getOrCreateVlan('default');
      this.logger.log('✅ VLAN created/retrieved via API');
      return {
        vlans: [vlan],
      };
    } catch (error) {
      this.logger.warn('⚠️  Database unavailable - VLAN will be created when first agent connects');
      // Return empty array if DB is not connected - frontend will show "Deploy agents" state
      return {
        vlans: [],
      };
    }
  }

  @Post('join')
  async joinVlan(@Body() body: { nodeId: string; vlanName?: string }) {
    try {
      const membership = await this.vlanService.joinVlan(body.nodeId, body.vlanName);
      return {
        success: true,
        membership,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new HttpException(message, HttpStatus.BAD_REQUEST);
    }
  }

  @Get(':vlanId/members')
  async getMembers(@Param('vlanId') vlanId: string) {
    try {
      const members = await this.vlanService.getVlanMembers(vlanId);
      return { members };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new HttpException(message, HttpStatus.NOT_FOUND);
    }
  }

  @Get(':vlanId/connections')
  async getConnections(@Param('vlanId') vlanId: string) {
    try {
      const connections = await this.vlanService.getVlanConnections(vlanId);
      return { connections };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new HttpException(message, HttpStatus.NOT_FOUND);
    }
  }

  @Get(':vlanId/status')
  async getStatus(@Param('vlanId') vlanId: string) {
    try {
      const status = await this.vlanService.getVlanStatus(vlanId);
      return status;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new HttpException(message, HttpStatus.NOT_FOUND);
    }
  }

  @Get(':vlanId/history')
  async getConnectionHistory(
    @Param('vlanId') vlanId: string,
    @Query('source') source: string,
    @Query('target') target: string,
    @Query('range') range?: string,
  ) {
    try {
      if (!source || !target) {
        throw new HttpException('Les paramètres source et target sont requis', HttpStatus.BAD_REQUEST);
      }
      return await this.vlanService.getConnectionHistory(vlanId, source, target, range);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new HttpException(message, HttpStatus.NOT_FOUND);
    }
  }

  @Get(':vlanId/tests')
  async getConnectionTests(@Param('vlanId') vlanId: string) {
    try {
      const tests = await this.vlanService.getRecentConnectionTests(vlanId);
      return { tests };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new HttpException(message, HttpStatus.NOT_FOUND);
    }
  }

  @Post(':vlanId/test')
  async runConnectionTest(
    @Param('vlanId') vlanId: string,
    @Body()
    body: {
      initiatorNodeId: string;
      targetNodeId: string;
      testType: 'ping' | 'traceroute';
    },
  ) {
    try {
      const members = await this.vlanService.getVlanMembers(vlanId);
      const initiator = members.find((member: any) => member.nodeId === body.initiatorNodeId);
      const target = members.find((member: any) => member.nodeId === body.targetNodeId);
      if (!initiator || !target) {
        throw new HttpException('Les nœuds sélectionnés ne font pas partie de ce VLAN', HttpStatus.BAD_REQUEST);
      }
      if (body.initiatorNodeId === body.targetNodeId) {
        throw new HttpException('Le nœud source et le nœud cible doivent être différents', HttpStatus.BAD_REQUEST);
      }
      if (!initiator.vlanIp || !target.vlanIp) {
        throw new HttpException('IPs VLAN introuvables pour le test', HttpStatus.BAD_REQUEST);
      }
      if (!this.isPrivateIp(initiator.vlanIp) || !this.isPrivateIp(target.vlanIp)) {
        throw new HttpException('Le test doit passer par des IPs VLAN privées', HttpStatus.BAD_REQUEST);
      }

      if (body.testType === 'traceroute') {
        let result: {
          status: 'success' | 'failed';
          message: string;
          latencyMs?: number;
          hops?: Array<{ hop: number; ip: string | null; latencyMs: number | null }>;
        };
        try {
          const trace = await this.agentsService.requestTraceroute(body.initiatorNodeId, target.vlanIp);
          const lastHop = trace.hops[trace.hops.length - 1];
          result = {
            status: 'success',
            message: `Traceroute vers ${target.vlanIp} : ${trace.hops.length} saut(s)`,
            latencyMs: typeof lastHop?.latencyMs === 'number' ? lastHop.latencyMs : undefined,
            hops: trace.hops,
          };
        } catch (error) {
          result = {
            status: 'failed',
            message: error instanceof Error ? error.message : 'Traceroute échoué',
          };
        }

        const test = await this.vlanService.recordConnectionTest(
          vlanId,
          body.initiatorNodeId,
          body.targetNodeId,
          'traceroute',
          result,
        );

        return { success: true, test };
      }

      const connections = await this.vlanService.getVlanConnections(vlanId);
      const connection = connections.find(
        (conn: any) =>
          (conn.sourceNodeId === body.initiatorNodeId && conn.targetNodeId === body.targetNodeId) ||
          (conn.sourceNodeId === body.targetNodeId && conn.targetNodeId === body.initiatorNodeId),
      );

      const status: 'success' | 'failed' = !connection || connection.status === 'offline' ? 'failed' : 'success';

      const result = {
        status,
        latencyMs: typeof connection?.latencyMs === 'number' ? connection.latencyMs : undefined,
        packetLoss: typeof connection?.packetLoss === 'number' ? connection.packetLoss : undefined,
        message: `Ping via VLAN privé ${initiator.vlanIp} -> ${target.vlanIp}`,
      };

      const test = await this.vlanService.recordConnectionTest(
        vlanId,
        body.initiatorNodeId,
        body.targetNodeId,
        'ping',
        result,
      );

      await this.vlanService.updateConnectionStatus(
        vlanId,
        body.initiatorNodeId,
        body.targetNodeId,
        connection?.status === 'degraded'
          ? 'degraded'
          : result.status === 'success'
            ? 'healthy'
            : 'offline',
        {
          latencyMs: result.latencyMs,
          packetLoss: result.packetLoss,
        },
      );

      return {
        success: true,
        test,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new HttpException(message, HttpStatus.BAD_REQUEST);
    }
  }

  @Post(':vlanId/members/:nodeId/gateway')
  async setGateway(
    @Param('vlanId') vlanId: string,
    @Param('nodeId') nodeId: string,
    @Body() body: { enabled: boolean },
  ) {
    try {
      const result = await this.vlanService.setGateway(vlanId, nodeId, Boolean(body.enabled));
      await this.agentsService.reconcileOverlayForVlan(vlanId);
      return { success: true, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new HttpException(message, HttpStatus.BAD_REQUEST);
    }
  }

  private isPrivateIp(ip: string) {
    if (ip.startsWith('10.')) return true;
    if (ip.startsWith('192.168.')) return true;
    if (!ip.startsWith('172.')) return false;
    const second = Number(ip.split('.')[1]);
    return Number.isFinite(second) && second >= 16 && second <= 31;
  }

  @Post('heartbeat')
  async heartbeat(@Body() body: { nodeId: string; vlanId?: string }) {
    try {
      const result = await this.vlanService.heartbeat(body.nodeId, body.vlanId);
      return {
        success: result !== null,
        membership: result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
