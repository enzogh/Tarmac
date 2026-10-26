import { Module } from '@nestjs/common';
import { NodeDailyStatsService } from './node-daily-stats.service';
import { ReportsController } from './reports.controller';
import { WeeklyReportService } from './weekly-report.service';

@Module({
  controllers: [ReportsController],
  providers: [NodeDailyStatsService, WeeklyReportService],
})
export class ReportsModule {}
