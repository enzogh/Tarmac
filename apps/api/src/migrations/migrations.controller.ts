import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateMigrationDto } from './dto/create-migration.dto';
import { UpdateMigrationDto } from './dto/update-migration.dto';
import { MigrationsService } from './migrations.service';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string };
}

@UseGuards(JwtAuthGuard)
@Controller('migrations')
export class MigrationsController {
  constructor(private readonly migrationsService: MigrationsService) {}

  @Get()
  list() {
    return this.migrationsService.list();
  }

  @Post()
  create(@Body() dto: CreateMigrationDto, @Req() req: AuthenticatedRequest) {
    return this.migrationsService.create(dto, req.user?.userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMigrationDto, @Req() req: AuthenticatedRequest) {
    return this.migrationsService.update(id, dto, req.user?.userId);
  }

  @Post(':id/start')
  start(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.migrationsService.update(id, { status: 'running' }, req.user?.userId);
  }

  @Post(':id/complete')
  complete(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.migrationsService.update(id, { status: 'completed' }, req.user?.userId);
  }
}
