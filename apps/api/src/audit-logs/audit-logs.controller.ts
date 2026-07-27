import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { toCsv } from '../common/csv';
import { AuditLogsService } from './audit-logs.service';

@UseGuards(JwtAuthGuard)
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  list(
    @Query('before') before?: string,
    @Query('from') from?: string,
    @Query('limit') limit?: string,
    @Query('actorUserId') actorUserId?: string,
    @Query('action') action?: string,
    @Query('resourceType') resourceType?: string,
    @Query('q') q?: string,
  ) {
    return this.auditLogsService.list({
      before: before ? new Date(before) : undefined,
      from: from ? new Date(from) : undefined,
      limit: limit ? Number(limit) : undefined,
      actorUserId,
      action,
      resourceType,
      q,
    });
  }

  @Get('export')
  async export(
    @Res({ passthrough: true }) res: Response,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('format') format: 'csv' | 'json' = 'json',
  ) {
    const rows = await this.auditLogsService.exportRange({ from: new Date(from), to: new Date(to) });

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="audit-logs.csv"');
      return toCsv(rows);
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="audit-logs.json"');
    return rows;
  }
}
