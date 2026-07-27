import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LiveWsServer } from '../live/live.ws';
import { PrismaService } from '../prisma/prisma.service';

// Raw agent log lines are high-volume (potentially dozens per node per
// minute) and only useful for recent troubleshooting, unlike AuditLog which
// is a permanent record of admin actions - so this table gets an automatic
// retention window instead of growing forever.
const RETENTION_DAYS = 14;
const EXPORT_ROW_CAP = 10_000;

@Injectable()
export class AgentLogsService {
  private readonly logger = new Logger(AgentLogsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly live: LiveWsServer,
  ) {}

  async create(input: { nodeId: string; level: string; message: string }) {
    const entry = await this.prisma.agentLog.create({ data: input });
    this.live.broadcast('agent-log.new', entry);
    return entry;
  }

  async list(params: { nodeId?: string; level?: string; before?: Date; from?: Date; limit?: number }) {
    const limit = Math.min(Math.max(params.limit ?? 200, 1), 500);
    const items = await this.prisma.agentLog.findMany({
      where: {
        AND: [
          params.nodeId ? { nodeId: params.nodeId } : {},
          params.level ? { level: params.level } : {},
          params.before ? { createdAt: { lt: params.before } } : {},
          params.from ? { createdAt: { gte: params.from } } : {},
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return {
      items,
      nextCursor: items.length === limit ? items[items.length - 1].createdAt.toISOString() : null,
    };
  }

  exportRange(params: { from: Date; to: Date; nodeId?: string }) {
    return this.prisma.agentLog.findMany({
      where: {
        AND: [{ createdAt: { gte: params.from, lte: params.to } }, params.nodeId ? { nodeId: params.nodeId } : {}],
      },
      orderBy: { createdAt: 'asc' },
      take: EXPORT_ROW_CAP,
    });
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async pruneOldLogs() {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.agentLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
    if (count > 0) {
      this.logger.log(`Pruned ${count} agent log line(s) older than ${RETENTION_DAYS} days`);
    }
  }
}
