import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { CurrentWorkspace, WorkspaceGuard, WorkspaceScope } from '../auth/workspace.guard';
import { ApiKeyOrJwtGuard, ApiKeyResource } from '../auth/api-key.guard';
import { CreateMountDto } from './dto/create-mount.dto';
import { UpdateMountDto } from './dto/update-mount.dto';
import { MountsService } from './mounts.service';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string };
}

@UseGuards(ApiKeyOrJwtGuard, WorkspaceGuard)
@ApiKeyResource('storage')
@Controller('mounts')
export class MountsController {
  constructor(private readonly mountsService: MountsService) {}

  @Get()
  list(@CurrentWorkspace() scope: WorkspaceScope) {
    return this.mountsService.list(scope);
  }

  @Post()
  create(@Body() dto: CreateMountDto, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.mountsService.create(dto, scope, req.user?.userId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMountDto,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.mountsService.update(id, dto, scope, req.user?.userId);
  }

  @Post(':id/remount')
  remount(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.mountsService.remount(id, scope, req.user?.userId);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    return this.mountsService.delete(id, scope, req.user?.userId);
  }
}
