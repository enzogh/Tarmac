import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CurrentWorkspace, WorkspaceGuard, WorkspaceScope } from '../auth/workspace.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AlertsService } from './alerts.service';
import { BulkDeleteAlertsDto } from './dto/bulk-delete-alerts.dto';
import { CreateAlertDto } from './dto/create-alert.dto';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string };
}

@UseGuards(JwtAuthGuard, WorkspaceGuard)
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  list(@CurrentWorkspace() scope: WorkspaceScope) {
    return this.alertsService.list(scope);
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
