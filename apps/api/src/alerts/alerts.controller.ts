import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AlertsService } from './alerts.service';
import { CreateAlertDto } from './dto/create-alert.dto';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string };
}

@UseGuards(JwtAuthGuard)
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  list() {
    return this.alertsService.list();
  }

  @Post()
  create(@Body() dto: CreateAlertDto, @Req() req: AuthenticatedRequest) {
    return this.alertsService.create(dto, req.user?.userId);
  }

  @Post(':id/ack')
  ack(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.alertsService.acknowledge(id, req.user?.userId);
  }

  @Post(':id/resolve')
  resolve(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.alertsService.resolve(id, req.user?.userId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.alertsService.remove(id, req.user?.userId);
  }
}
