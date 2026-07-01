import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreatePoolDto } from './dto/create-pool.dto';
import { UpdatePoolDto } from './dto/update-pool.dto';
import { UpsertPoolMemberDto } from './dto/upsert-pool-member.dto';
import { PoolsService } from './pools.service';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string };
}

@UseGuards(JwtAuthGuard)
@Controller('pools')
export class PoolsController {
  constructor(private readonly poolsService: PoolsService) {}

  @Get()
  list() {
    return this.poolsService.list();
  }

  @Post()
  create(@Body() dto: CreatePoolDto, @Req() req: AuthenticatedRequest) {
    return this.poolsService.create(dto, req.user?.userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePoolDto, @Req() req: AuthenticatedRequest) {
    return this.poolsService.update(id, dto, req.user?.userId);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.poolsService.delete(id, req.user?.userId);
  }

  @Post(':id/members')
  addMember(@Param('id') id: string, @Body() dto: UpsertPoolMemberDto, @Req() req: AuthenticatedRequest) {
    return this.poolsService.upsertMember(id, dto, req.user?.userId);
  }

  @Patch(':id/members/:nodeId')
  updateMember(
    @Param('id') id: string,
    @Param('nodeId') nodeId: string,
    @Body() dto: Omit<UpsertPoolMemberDto, 'nodeId'>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.poolsService.upsertMember(
      id,
      { nodeId, role: dto.role, status: dto.status },
      req.user?.userId,
    );
  }

  @Delete(':id/members/:nodeId')
  removeMember(@Param('id') id: string, @Param('nodeId') nodeId: string, @Req() req: AuthenticatedRequest) {
    return this.poolsService.removeMember(id, nodeId, req.user?.userId);
  }
}
