import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateNotificationChannelDto } from './dto/create-notification-channel.dto';
import { UpdateNotificationChannelDto } from './dto/update-notification-channel.dto';
import { NotificationChannelsService } from './notification-channels.service';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string };
}

@UseGuards(JwtAuthGuard)
@Controller('notification-channels')
export class NotificationChannelsController {
  constructor(private readonly notificationChannelsService: NotificationChannelsService) {}

  @Get()
  list() {
    return this.notificationChannelsService.list();
  }

  @Post()
  create(@Body() dto: CreateNotificationChannelDto, @Req() req: AuthenticatedRequest) {
    return this.notificationChannelsService.create(dto, req.user?.userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateNotificationChannelDto, @Req() req: AuthenticatedRequest) {
    return this.notificationChannelsService.update(id, dto, req.user?.userId);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.notificationChannelsService.delete(id, req.user?.userId);
  }

  @Post(':id/test')
  test(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.notificationChannelsService.test(id, req.user?.userId);
  }
}
