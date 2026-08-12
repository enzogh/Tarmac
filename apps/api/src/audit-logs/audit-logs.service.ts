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

  // NOTE: log() below does not yet stamp workspaceId on new rows (it stays
  // null - AuditLog.workspaceId is deliberately nullable in the Phase 0
  // schema for exactly this reason). The Phase 0 migration backfilled every
  // *pre-existing* row into the Default workspace, so historical entries are
  // correctly scoped, but entries logged between the Phase 0 and Phase 1
  // deploys - and any future ones, until a follow-up threads a workspace id
  // through this service's ~40 call sites across the codebase - will have a
  // null workspaceId and so be invisible to non-admin members (safe: no
  // cross-tenant leak, just an incomplete view for now).
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
          scope.isPlatformAdmin ? {} : { workspaceId: scope.workspaceId },
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
        ...(scope.isPlatformAdmin ? {} : { workspaceId: scope.workspaceId }),
      },
      orderBy: { createdAt: 'asc' },
      take: EXPORT_ROW_CAP,
    });
  }

  async log(input: {
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
