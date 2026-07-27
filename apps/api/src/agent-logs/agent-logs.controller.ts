import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { toCsv } from '../common/csv';
import { AgentLogsService } from './agent-logs.service';

@UseGuards(JwtAuthGuard)
@Controller('agent-logs')
export class AgentLogsController {
  constructor(private readonly agentLogsService: AgentLogsService) {}

  @Get()
  list(
    @Query('nodeId') nodeId?: string,
    @Query('level') level?: string,
    @Query('before') before?: string,
    @Query('from') from?: string,
    @Query('limit') limit?: string,
  ) {
    return this.agentLogsService.list({
      nodeId,
      level,
      before: before ? new Date(before) : undefined,
      from: from ? new Date(from) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('export')
  async export(
    @Res({ passthrough: true }) res: Response,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('format') format: 'csv' | 'json' = 'json',
    @Query('nodeId') nodeId?: string,
  ) {
    const rows = await this.agentLogsService.exportRange({ from: new Date(from), to: new Date(to), nodeId });

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="agent-logs.csv"');
      return toCsv(rows);
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="agent-logs.json"');
    return rows;
  }
}
