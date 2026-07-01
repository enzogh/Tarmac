import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateMountDto } from './dto/create-mount.dto';
import { UpdateMountDto } from './dto/update-mount.dto';
import { MountsService } from './mounts.service';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string };
}

@UseGuards(JwtAuthGuard)
@Controller('mounts')
export class MountsController {
  constructor(private readonly mountsService: MountsService) {}

  @Get()
  list() {
    return this.mountsService.list();
  }

  @Post()
  create(@Body() dto: CreateMountDto, @Req() req: AuthenticatedRequest) {
    return this.mountsService.create(dto, req.user?.userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMountDto, @Req() req: AuthenticatedRequest) {
    return this.mountsService.update(id, dto, req.user?.userId);
  }

  @Post(':id/remount')
  remount(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.mountsService.remount(id, req.user?.userId);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.mountsService.delete(id, req.user?.userId);
  }
}
