import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuditLogsService } from './audit-logs.service';

@UseGuards(JwtAuthGuard)
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  list(@Query('limit') limit?: string) {
    const parsed = limit ? Number(limit) : 200;
    return this.auditLogsService.list(Number.isFinite(parsed) ? parsed : 200);
  }
}
