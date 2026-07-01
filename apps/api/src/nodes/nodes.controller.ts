import {
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
import { CreateNodeDto } from './dto/create-node.dto';
import { UpdateNodeDto } from './dto/update-node.dto';
import { NodesService } from './nodes.service';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string };
}

@UseGuards(JwtAuthGuard)
@Controller('nodes')
export class NodesController {
  constructor(private readonly nodesService: NodesService) {}

  @Get()
  list() {
    return this.nodesService.list();
  }

  @Post()
  create(@Body() dto: CreateNodeDto, @Req() req: AuthenticatedRequest) {
    return this.nodesService.create(dto, req.user?.userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateNodeDto, @Req() req: AuthenticatedRequest) {
    return this.nodesService.update(id, dto, req.user?.userId);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.nodesService.delete(id, req.user?.userId);
  }

  @Get(':id/metrics')
  metrics(@Param('id') id: string, @Query('range') range = '1h') {
    return this.nodesService.metrics(id, range);
  }
}
