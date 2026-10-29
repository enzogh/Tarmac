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

  // Platform admins (superusers) only - see AgentLogsController.remove.
  async remove(params: { nodeId?: string; level?: string; from?: Date }, scope: WorkspaceScope) {
    const scopedNodeIds = await this.scopedNodeIds(scope);
    if (params.nodeId && !scopedNodeIds.includes(params.nodeId)) return { deleted: 0 };
    const { count } = await this.prisma.agentLog.deleteMany({
      where: {
        AND: [
          { nodeId: params.nodeId ? params.nodeId : { in: scopedNodeIds } },
          params.level ? { level: params.level } : {},
          params.from ? { createdAt: { gte: params.from } } : {},
        ],
      },
    });
    return { deleted: count };
  }

  // Each workspace keeps its nodes' logs as long as it chose (Settings);
  // lines of nodes that no longer exist go after RETENTION_DAYS.
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async pruneOldLogs() {
    const nodes = await this.prisma.node.findMany({ select: { id: true, workspace: { select: { agentLogRetentionDays: true } } } });
    const byDays = new Map<number, string[]>();
    for (const node of nodes) {
      const days = node.workspace?.agentLogRetentionDays ?? RETENTION_DAYS;
      byDays.set(days, [...(byDays.get(days) ?? []), node.id]);
    }
    const dayMs = 24 * 60 * 60 * 1000;
    let total = 0;
    for (const [days, nodeIds] of byDays) {
      const { count } = await this.prisma.agentLog.deleteMany({ where: { nodeId: { in: nodeIds }, createdAt: { lt: new Date(Date.now() - days * dayMs) } } });
      total += count;
    }
    const known = nodes.map((node) => node.id);
    const { count: orphans } = await this.prisma.agentLog.deleteMany({
      where: { nodeId: { notIn: known }, createdAt: { lt: new Date(Date.now() - RETENTION_DAYS * dayMs) } },
    });
    total += orphans;
    if (total > 0) this.logger.log(`Pruned ${total} agent log line(s) past their workspace's retention`);
  }
}
