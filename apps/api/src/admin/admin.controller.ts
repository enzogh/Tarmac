import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminService } from './admin.service';
import { UpdateUserLimitDto } from './dto/update-user-limit.dto';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string };
}

@UseGuards(JwtAuthGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  async listUsers(@Req() req: AuthenticatedRequest) {
    await this.adminService.assertSuperuser(req.user?.userId);
    return this.adminService.listUsers();
  }

  @Patch('users/:id')
  async updateUser(@Param('id') id: string, @Body() dto: UpdateUserLimitDto, @Req() req: AuthenticatedRequest) {
    await this.adminService.assertSuperuser(req.user?.userId);
    return this.adminService.updateUserLimit(id, dto.workspaceLimit ?? null, req.user?.userId);
  }
}
