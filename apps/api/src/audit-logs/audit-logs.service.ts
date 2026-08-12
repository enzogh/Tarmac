import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LiveWsServer } from '../live/live.ws';
import { WorkspaceScope } from '../auth/workspace.guard';
import { PrismaService } from '../prisma/prisma.service';

const EXPORT_ROW_CAP = 10_000;

@Injectable()
export class AuditLogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly live: LiveWsServer,
  ) {}

  async list(
    params: {
      before?: Date;
      from?: Date;
      limit?: number;
      actorUserId?: string;
      action?: string;
      resourceType?: string;
      q?: string;
    },
    scope: WorkspaceScope,
  ) {
    const limit = Math.min(Math.max(params.limit ?? 200, 1), 500);
    const items = await this.prisma.auditLog.findMany({
      where: {
        AND: [
          params.before ? { createdAt: { lt: params.before } } : {},
          params.from ? { createdAt: { gte: params.from } } : {},
          params.actorUserId ? { actorUserId: params.actorUserId } : {},
          params.action ? { action: params.action } : {},
          params.resourceType ? { resourceType: params.resourceType } : {},
          params.q
            ? {
                OR: [
                  { action: { contains: params.q, mode: 'insensitive' as const } },
                  { resourceType: { contains: params.q, mode: 'insensitive' as const } },
                  { resourceId: { contains: params.q, mode: 'insensitive' as const } },
                ],
              }
            : {},
          { workspaceId: scope.workspaceId },
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

  exportRange(params: { from: Date; to: Date }, scope: WorkspaceScope) {
    return this.prisma.auditLog.findMany({
      where: {
        createdAt: { gte: params.from, lte: params.to },
        workspaceId: scope.workspaceId,
      },
      orderBy: { createdAt: 'asc' },
      take: EXPORT_ROW_CAP,
    });
  }

  // workspaceId is required (not inferred from a WorkspaceScope here) since
  // several callers log actions with no scope in context at all - a
  // webhook-triggered sync job run, for instance - so every call site
  // passes it explicitly from whatever it already has on hand (a resource's
  // own workspaceId, or scope.workspaceId when a human request is what
  // triggered the action).
  async log(input: {
    workspaceId: string;
    actorUserId?: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    details?: Prisma.InputJsonValue;
  }) {
    const entry = await this.prisma.auditLog.create({ data: input });
    this.live.broadcast('audit.new', entry);
    return entry;
  }
}
