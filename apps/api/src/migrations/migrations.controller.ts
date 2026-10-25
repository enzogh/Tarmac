import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CurrentWorkspace, WorkspaceGuard, WorkspaceScope } from '../auth/workspace.guard';
import { ApiKeyOrJwtGuard, ApiKeyResource, RequireApiScope } from '../auth/api-key.guard';
import { CreateMigrationDto } from './dto/create-migration.dto';
import { ListRemoteDirectoriesDto } from './dto/list-remote-directories.dto';
import { UpdateMigrationDto } from './dto/update-migration.dto';
import { MigrationsService } from './migrations.service';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string };
}

@UseGuards(ApiKeyOrJwtGuard, WorkspaceGuard)
@ApiKeyResource('storage')
@Controller('migrations')
export class MigrationsController {
  constructor(private readonly migrationsService: MigrationsService) {}

  @Get()
  list(@CurrentWorkspace() scope: WorkspaceScope) {
    return this.migrationsService.list(scope);
  }

  @Get('directories')
  listDirectories(
    @Query('nodeId') nodeId: string | undefined,
    @Query('basePath') basePath: string | undefined,
    @CurrentWorkspace() scope: WorkspaceScope,
  ) {
    if (!nodeId) {
      throw new BadRequestException('nodeId is required');
    }
    return this.migrationsService.listDirectories(nodeId, basePath || '/', scope);
  }

  @Get('directories/scan')
  scanDirectories(
    @Query('nodeId') nodeId: string | undefined,
    @Query('basePath') basePath: string | undefined,
    @Query('maxEntries') maxEntries: string | undefined,
    @CurrentWorkspace() scope: WorkspaceScope,
  ) {
    if (!nodeId) {
      throw new BadRequestException('nodeId is required');
    }
    const parsedMaxEntries = Number.parseInt(maxEntries ?? '20', 10);
    return this.migrationsService.scanDirectories(
      nodeId,
      basePath || '/',
      Number.isFinite(parsedMaxEntries) ? parsedMaxEntries : 20,
      scope,
    );
  }

  // Lists a remote host's directories: a read, despite the POST body.
  @Post('directories/remote')
  @RequireApiScope('storage:read')
  listRemoteDirectories(@Body() dto: ListRemoteDirectoriesDto, @CurrentWorkspace() scope: WorkspaceScope) {
    const parsedPort = dto.port ? Number.parseInt(dto.port, 10) : undefined;
    return this.migrationsService.listRemoteDirectories(
      dto.nodeId,
      {
        host: dto.host,
        username: dto.username,
        password: dto.password,
        port: Number.isFinite(parsedPort) ? parsedPort : undefined,
        basePath: dto.basePath,
        endpointType: dto.endpointType,
      },
      scope,
    );
  }

  @Post()
  create(@Body() dto: CreateMigrationDto, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.migrationsService.create(dto, scope, req.user?.userId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMigrationDto,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.migrationsService.update(id, dto, scope, req.user?.userId);
  }

  @Post(':id/start')
  start(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.migrationsService.start(id, scope, req.user?.userId);
  }

  @Post(':id/retry')
  retry(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.migrationsService.retry(id, scope, req.user?.userId);
  }

  @Post(':id/stop')
  stop(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.migrationsService.stop(id, scope, req.user?.userId);
  }

  @Post(':id/complete')
  complete(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.migrationsService.update(id, { status: 'completed' }, scope, req.user?.userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    await this.migrationsService.removePending(id, scope, req.user?.userId);
  }
}
