import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LiveWsServer } from '../live/live.ws';
import { WorkspaceScope } from '../auth/workspace.guard';
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

  async create(input: { nodeId: string; level: string; message: string; workspaceId: string }) {
    const { workspaceId, ...data } = input;
    const entry = await this.prisma.agentLog.create({ data });
    this.live.broadcast('agent-log.new', entry, workspaceId);
    return entry;
  }

  // AgentLog has no direct workspaceId column (see schema comment) - scoped
  // via a subquery on Node ids in the caller's workspace rather than a
  // relational `where: { node: {...} } }` join, since AgentLog has no FK to
  // Node (nodeId is only indexed, not constrained - see schema.prisma).
  private async scopedNodeIds(scope: WorkspaceScope): Promise<string[]> {
    const nodes = await this.prisma.node.findMany({ where: { workspaceId: scope.workspaceId }, select: { id: true } });
    return nodes.map((n) => n.id);
  }

  async list(
    params: { nodeId?: string; level?: string; before?: Date; from?: Date; limit?: number },
    scope: WorkspaceScope,
  ) {
    const limit = Math.min(Math.max(params.limit ?? 200, 1), 500);
    const scopedNodeIds = await this.scopedNodeIds(scope);
    const items = await this.prisma.agentLog.findMany({
      where: {
        AND: [
          params.nodeId ? { nodeId: params.nodeId } : {},
          params.level ? { level: params.level } : {},
          params.before ? { createdAt: { lt: params.before } } : {},
          params.from ? { createdAt: { gte: params.from } } : {},
          scopedNodeIds ? { nodeId: { in: scopedNodeIds } } : {},
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

  async exportRange(params: { from: Date; to: Date; nodeId?: string }, scope: WorkspaceScope) {
    const scopedNodeIds = await this.scopedNodeIds(scope);
    return this.prisma.agentLog.findMany({
      where: {
        AND: [
          { createdAt: { gte: params.from, lte: params.to } },
          params.nodeId ? { nodeId: params.nodeId } : {},
          scopedNodeIds ? { nodeId: { in: scopedNodeIds } } : {},
        ],
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
