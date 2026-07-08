import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
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

  @UseGuards(JwtAuthGuard)
  @Get('runs')
  listAllRuns() {
    return this.syncJobsService.listAllRuns();
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  list() {
    return this.syncJobsService.list();
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateSyncJobDto, @Req() req: AuthenticatedRequest) {
    return this.syncJobsService.create(dto, req.user?.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSyncJobDto, @Req() req: AuthenticatedRequest) {
    return this.syncJobsService.update(id, dto, req.user?.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  delete(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.syncJobsService.delete(id, req.user?.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/runs')
  listRuns(@Param('id') id: string) {
    return this.syncJobsService.listRuns(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/runs')
  run(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.syncJobsService.run(id, req.user?.userId, 'manual');
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/trigger-token/rotate')
  rotateTriggerToken(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.syncJobsService.rotateTriggerToken(id, req.user?.userId);
  }

  /**
   * Unauthenticated route (no JwtAuthGuard) meant for non-interactive callers
   * such as a qBittorrent "run external program on completion" script.
   * Authenticated instead by the per-job X-Trigger-Token header, same
   * pattern as AgentsController's uninstall route.
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
