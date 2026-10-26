import { Body, Controller, ForbiddenException, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentWorkspace, WorkspaceGuard, WorkspaceScope } from '../auth/workspace.guard';
import { ApiKeyOrJwtGuard, ApiKeyResource } from '../auth/api-key.guard';
import { toCsv } from '../common/csv';
import { AuditLogsService } from './audit-logs.service';
import { DeleteAuditLogsDto } from './dto/delete-audit-logs.dto';

@UseGuards(ApiKeyOrJwtGuard, WorkspaceGuard)
@ApiKeyResource('logs')
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  list(
    @CurrentWorkspace() scope: WorkspaceScope,
    @Query('before') before?: string,
    @Query('from') from?: string,
    @Query('limit') limit?: string,
    @Query('actorUserId') actorUserId?: string,
    @Query('action') action?: string,
    @Query('resourceType') resourceType?: string,
    @Query('q') q?: string,
  ) {
    return this.auditLogsService.list(
      {
        before: before ? new Date(before) : undefined,
        from: from ? new Date(from) : undefined,
        limit: limit ? Number(limit) : undefined,
        actorUserId,
        action,
        resourceType,
        q,
      },
      scope,
    );
  }

  // Superusers only, in whichever workspace they are looking at: workspace
  // owners and API keys can read and export the journal, never rewrite it.
  @Post('delete')
  remove(@Body() dto: DeleteAuditLogsDto, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: Request & { user?: { userId?: string } }) {
    if (!scope.isPlatformAdmin) throw new ForbiddenException('Seul un administrateur de la plateforme peut supprimer des entrées du journal.');
    return this.auditLogsService.remove(
      {
        ids: dto.ids,
        from: dto.from ? new Date(dto.from) : undefined,
        actorUserId: dto.actorUserId,
        resourceType: dto.resourceType,
        q: dto.q?.trim() || undefined,
      },
      scope,
      req.user?.userId,
    );
  }

  @Get('facets')
  facets(@CurrentWorkspace() scope: WorkspaceScope) {
    return this.auditLogsService.facets(scope);
  }

  @Get('export')
  async export(
    @Res({ passthrough: true }) res: Response,
    @CurrentWorkspace() scope: WorkspaceScope,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('format') format: 'csv' | 'json' = 'json',
  ) {
    const rows = await this.auditLogsService.exportRange({ from: new Date(from), to: new Date(to) }, scope);

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
