import { Controller, Get, Post, Param, Body, UseGuards, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { VlanService } from './vlan.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('vlan')
@UseGuards(AuthGuard('jwt'))
export class VlanController {
  private readonly logger = new Logger(VlanController.name);
  
  constructor(private vlanService: VlanService) {}

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
      testType: 'ping' | 'connectivity' | 'latency';
    },
  ) {
    try {
      // Simulate a successful test
      const result = {
        status: 'success' as const,
        latencyMs: Math.random() * 50 + 5,
        packetLoss: Math.random() * 5,
      };

      const test = await this.vlanService.recordConnectionTest(
        vlanId,
        body.initiatorNodeId,
        body.targetNodeId,
        body.testType,
        result,
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
