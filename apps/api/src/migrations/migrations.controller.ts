import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateMigrationDto } from './dto/create-migration.dto';
import { ListRemoteDirectoriesDto } from './dto/list-remote-directories.dto';
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

  @Get('directories')
  listDirectories(@Query('nodeId') nodeId?: string, @Query('basePath') basePath?: string) {
    if (!nodeId) {
      throw new BadRequestException('nodeId is required');
    }
    return this.migrationsService.listDirectories(nodeId, basePath || '/');
  }

  @Get('directories/scan')
  scanDirectories(
    @Query('nodeId') nodeId?: string,
    @Query('basePath') basePath?: string,
    @Query('maxEntries') maxEntries?: string,
  ) {
    if (!nodeId) {
      throw new BadRequestException('nodeId is required');
    }
    const parsedMaxEntries = Number.parseInt(maxEntries ?? '20', 10);
    return this.migrationsService.scanDirectories(
      nodeId,
      basePath || '/',
      Number.isFinite(parsedMaxEntries) ? parsedMaxEntries : 20,
    );
  }

  @Post('directories/remote')
  listRemoteDirectories(@Body() dto: ListRemoteDirectoriesDto) {
    const parsedPort = dto.port ? Number.parseInt(dto.port, 10) : undefined;
    return this.migrationsService.listRemoteDirectories(dto.nodeId, {
      host: dto.host,
      username: dto.username,
      password: dto.password,
      port: Number.isFinite(parsedPort) ? parsedPort : undefined,
      basePath: dto.basePath,
      endpointType: dto.endpointType,
    });
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
    return this.migrationsService.start(id, req.user?.userId);
  }

  @Post(':id/retry')
  retry(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.migrationsService.retry(id, req.user?.userId);
  }

  @Post(':id/stop')
  stop(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.migrationsService.stop(id, req.user?.userId);
  }

  @Post(':id/complete')
  complete(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.migrationsService.update(id, { status: 'completed' }, req.user?.userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.migrationsService.removePending(id, req.user?.userId);
  }
}
