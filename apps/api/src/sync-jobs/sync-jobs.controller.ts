import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CurrentWorkspace, WorkspaceGuard, WorkspaceScope } from '../auth/workspace.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateSyncJobDto } from './dto/create-sync-job.dto';
import { UpdateSyncJobDto } from './dto/update-sync-job.dto';
import { SyncJobsService } from './sync-jobs.service';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string };
}

@Controller('sync-jobs')
export class SyncJobsController {
  constructor(private readonly syncJobsService: SyncJobsService) {}

  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @Get('runs')
  listAllRuns(@CurrentWorkspace() scope: WorkspaceScope) {
    return this.syncJobsService.listAllRuns(scope);
  }

  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @Get()
  list(@CurrentWorkspace() scope: WorkspaceScope) {
    return this.syncJobsService.list(scope);
  }

  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @Post()
  create(@Body() dto: CreateSyncJobDto, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.syncJobsService.create(dto, scope, req.user?.userId);
  }

  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSyncJobDto,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.syncJobsService.update(id, dto, scope, req.user?.userId);
  }

  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @Delete(':id')
  delete(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.syncJobsService.delete(id, scope, req.user?.userId);
  }

  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @Get(':id/runs')
  listRuns(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope) {
    return this.syncJobsService.listRuns(id, scope);
  }

  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @Post(':id/runs')
  run(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.syncJobsService.run(id, req.user?.userId, 'manual', undefined, scope);
  }

  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @Post(':id/trigger-token/rotate')
  rotateTriggerToken(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.syncJobsService.rotateTriggerToken(id, scope, req.user?.userId);
  }

  /**
   * Unauthenticated route (no JwtAuthGuard/WorkspaceGuard) meant for
   * non-interactive callers such as a qBittorrent "run external program on
   * completion" script. Authenticated instead by the per-job X-Trigger-Token
   * header, same pattern as AgentsController's uninstall route - the token
   * itself is the authorization proof, so no workspace scope is available or
   * needed here.
   *
   * relativePath is optional: pass qBittorrent's %N (torrent name) to scope
   * the run to just that item instead of re-mirroring the whole source
   * folder - avoids re-pulling files already moved out of targetPath by a
   * downstream tool like Radarr.
   */
  @Post(':id/trigger')
  trigger(
    @Param('id') id: string,
    @Headers('x-trigger-token') triggerToken?: string,
    @Query('relativePath') relativePath?: string,
  ) {
    return this.syncJobsService.triggerViaToken(id, triggerToken, relativePath);
  }
}
