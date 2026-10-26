import { Controller, ForbiddenException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentWorkspace, WorkspaceGuard, WorkspaceScope } from '../auth/workspace.guard';
import { WeeklyReportService } from './weekly-report.service';

interface AuthenticatedRequest extends Request {
  user?: { userId?: string };
}

@UseGuards(JwtAuthGuard, WorkspaceGuard)
@Controller('workspaces/:id/weekly-report')
export class ReportsController {
  constructor(private readonly weeklyReport: WeeklyReportService) {}

  // Administrators of the workspace can get this week's report right away.
  @Post('preview')
  preview(@Param('id') id: string, @CurrentWorkspace() scope: WorkspaceScope, @Req() req: AuthenticatedRequest) {
    if (scope.workspaceId !== id || !scope.isManager) {
      throw new ForbiddenException('Réservé aux administrateurs du workspace.');
    }
    return this.weeklyReport.sendPreview(id, req.user?.userId);
  }
}
