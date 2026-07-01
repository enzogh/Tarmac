import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateSyncJobDto } from './dto/create-sync-job.dto';
import { UpdateSyncJobDto } from './dto/update-sync-job.dto';
import { SyncJobsService } from './sync-jobs.service';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string };
}

@UseGuards(JwtAuthGuard)
@Controller('sync-jobs')
export class SyncJobsController {
  constructor(private readonly syncJobsService: SyncJobsService) {}

  @Get('runs')
  listAllRuns() {
    return this.syncJobsService.listAllRuns();
  }

  @Get()
  list() {
    return this.syncJobsService.list();
  }

  @Post()
  create(@Body() dto: CreateSyncJobDto, @Req() req: AuthenticatedRequest) {
    return this.syncJobsService.create(dto, req.user?.userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSyncJobDto, @Req() req: AuthenticatedRequest) {
    return this.syncJobsService.update(id, dto, req.user?.userId);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.syncJobsService.delete(id, req.user?.userId);
  }

  @Get(':id/runs')
  listRuns(@Param('id') id: string) {
    return this.syncJobsService.listRuns(id);
  }

  @Post(':id/runs')
  run(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.syncJobsService.run(id, req.user?.userId);
  }
}
