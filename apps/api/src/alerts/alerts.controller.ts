import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { toCsv } from '../common/csv';
import { CurrentWorkspace, WorkspaceGuard, WorkspaceScope } from '../auth/workspace.guard';
import { ApiKeyOrJwtGuard, ApiKeyResource } from '../auth/api-key.guard';
import { AlertsService } from './alerts.service';
import { BulkDeleteAlertsDto } from './dto/bulk-delete-alerts.dto';
import { CreateAlertDto } from './dto/create-alert.dto';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string };
}

@UseGuards(ApiKeyOrJwtGuard, WorkspaceGuard)
@ApiKeyResource('alerts')
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  list(@CurrentWorkspace() scope: WorkspaceScope) {
    return this.alertsService.list(scope);
  }

  // Before ':id' routes. Default period: the last 30 days.
  @Get('export')
  async export(
    @Res({ passthrough: true }) res: Response,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('format') format: 'csv' | 'json' = 'csv',
  ) {
    const range = { from: from ? new Date(from) : new Date(Date.now() - 30 * 86_400_000), to: to ? new Date(to) : new Date() };
    if (Number.isNaN(range.from.getTime()) || Number.isNaN(range.to.getTime())) throw new BadRequestException('Période invalide.');
    const rows = await this.alertsService.exportRange(range, scope);
    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="alertes.json"');
      return rows;
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="alertes.csv"');
    return toCsv(rows);
  }

  @Post()
  create(@Body() dto: CreateAlertDto, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.alertsService.create(dto, scope, req.user?.userId);
  }

  @Post(':id/ack')
  ack(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.alertsService.acknowledge(id, scope, req.user?.userId);
  }

  @Post(':id/resolve')
  resolve(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.alertsService.resolve(id, scope, req.user?.userId);
  }

  @Delete()
  removeBulk(@Body() dto: BulkDeleteAlertsDto, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.alertsService.removeMany(dto.ids, scope, req.user?.userId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.alertsService.remove(id, scope, req.user?.userId);
  }
}
