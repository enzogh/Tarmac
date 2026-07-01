import { Controller, Get, Post, Param, Body, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { VlanService } from './vlan.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('api/v1/vlan')
@UseGuards(AuthGuard('jwt'))
export class VlanController {
  constructor(private vlanService: VlanService) {}

  @Get()
  async getAllVlans() {
    try {
      // For now, return the default VLAN status
      const vlan = await this.vlanService.getOrCreateVlan('default');
      return {
        vlans: [vlan],
      };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
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
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Get(':vlanId/members')
  async getMembers(@Param('vlanId') vlanId: string) {
    try {
      const members = await this.vlanService.getVlanMembers(vlanId);
      return { members };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    }
  }

  @Get(':vlanId/connections')
  async getConnections(@Param('vlanId') vlanId: string) {
    try {
      const connections = await this.vlanService.getVlanConnections(vlanId);
      return { connections };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    }
  }

  @Get(':vlanId/status')
  async getStatus(@Param('vlanId') vlanId: string) {
    try {
      const status = await this.vlanService.getVlanStatus(vlanId);
      return status;
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.NOT_FOUND);
    }
  }

  @Get(':vlanId/tests')
  async getConnectionTests(@Param('vlanId') vlanId: string) {
    try {
      const tests = await this.vlanService.getRecentConnectionTests(vlanId);
      return { tests };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.NOT_FOUND);
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
      throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
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
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
