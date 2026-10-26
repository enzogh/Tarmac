import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

export const REPORT_TIME_ZONE = 'Europe/Paris';
const RETENTION_DAYS = 120;

// Raw metrics only live three days; availability over a week (and how fast
// disks fill) needs something longer. Once a minute, every node adds one
// "observed" minute to today's row, plus one "online" minute if it is up,
// and the row keeps the disk usage of the last sample.
@Injectable()
export class NodeDailyStatsService {
  private readonly logger = new Logger(NodeDailyStatsService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sample() {
    try {
      await this.prisma.$executeRaw`
        INSERT INTO "NodeDailyStat" ("nodeId", "day", "observedMinutes", "onlineMinutes", "diskUsedGb", "diskCapacityGb")
        SELECT n."id",
               (now() AT TIME ZONE ${REPORT_TIME_ZONE})::date,
               1,
               CASE WHEN n."status" = 'online' THEN 1 ELSE 0 END,
               d."used",
               d."capacity"
        FROM "Node" n
        LEFT JOIN (
          SELECT "nodeId", SUM("usedGb")::int AS "used", SUM("capacityGb")::int AS "capacity"
          FROM "Disk" GROUP BY "nodeId"
        ) d ON d."nodeId" = n."id"
        ON CONFLICT ("nodeId", "day") DO UPDATE SET
          "observedMinutes" = "NodeDailyStat"."observedMinutes" + 1,
          "onlineMinutes" = "NodeDailyStat"."onlineMinutes" + EXCLUDED."onlineMinutes",
          "diskUsedGb" = COALESCE(EXCLUDED."diskUsedGb", "NodeDailyStat"."diskUsedGb"),
          "diskCapacityGb" = COALESCE(EXCLUDED."diskCapacityGb", "NodeDailyStat"."diskCapacityGb")
      `;
    } catch (error) {
      this.logger.warn(`Node daily stats sample failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async prune() {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
    const { count } = await this.prisma.nodeDailyStat.deleteMany({ where: { day: { lt: cutoff } } });
    if (count > 0) this.logger.log(`Pruned ${count} node daily stat(s) older than ${RETENTION_DAYS} days`);
  }
}
