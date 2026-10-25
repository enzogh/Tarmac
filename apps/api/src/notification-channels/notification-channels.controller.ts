import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CurrentWorkspace, WorkspaceGuard, WorkspaceScope } from '../auth/workspace.guard';
import { ApiKeyOrJwtGuard, ApiKeyResource } from '../auth/api-key.guard';
import { CreateNotificationChannelDto } from './dto/create-notification-channel.dto';
import { UpdateNotificationChannelDto } from './dto/update-notification-channel.dto';
import { NotificationChannelsService } from './notification-channels.service';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string };
}

@UseGuards(ApiKeyOrJwtGuard, WorkspaceGuard)
@ApiKeyResource('alerts')
@Controller('notification-channels')
export class NotificationChannelsController {
  constructor(private readonly notificationChannelsService: NotificationChannelsService) {}

  @Get()
  list(@CurrentWorkspace() scope: WorkspaceScope) {
    return this.notificationChannelsService.list(scope);
  }

  @Post()
  create(
    @Body() dto: CreateNotificationChannelDto,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.notificationChannelsService.create(dto, scope, req.user?.userId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateNotificationChannelDto,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.notificationChannelsService.update(id, dto, scope, req.user?.userId);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.notificationChannelsService.delete(id, scope, req.user?.userId);
  }

  @Post(':id/test')
  test(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.notificationChannelsService.test(id, scope, req.user?.userId);
  }
}
