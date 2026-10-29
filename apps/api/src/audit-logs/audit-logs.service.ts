import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { requestContext } from '../common/request-context';
import { LiveWsServer } from '../live/live.ws';
import { WorkspaceScope } from '../auth/workspace.guard';
import { PrismaService } from '../prisma/prisma.service';

const EXPORT_ROW_CAP = 10_000;
// Prisma cuid: what resource ids, and the ids inside `details`, look like.
const ID_PATTERN = /^c[a-z0-9]{24}$/;

type Actor = { id: string; name: string; email: string };

export function actorDisplayName(user: { name: string | null; email: string }): string {
  return user.name?.trim() || user.email.split('@')[0];
}

function collectIds(value: unknown, into: Set<string>, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (ID_PATTERN.test(value)) into.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value.slice(0, 50)) collectIds(item, into, depth + 1);
  } else if (typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) collectIds(item, into, depth + 1);
  }
}

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
      where: await this.filterWhere(params, scope),
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const { actors, refs } = await this.resolve(items, scope);
    return {
      items: items.map(({ snapshot, ...item }) => ({
        ...item,
        // Undoable from the Journal: a "before" state kept, not used yet.
        restorable: Boolean(snapshot) && !item.restoredAt,
        actor: item.actorUserId ? (actors.get(item.actorUserId) ?? null) : null,
      })),
      // id -> display name for every resource id and id found in details,
      // so the journal reads "ns320594" instead of "cmr5c2odb".
      refs: Object.fromEntries(refs),
      nextCursor: items.length === limit ? items[items.length - 1].createdAt.toISOString() : null,
    };
  }

  private async filterWhere(
    params: { before?: Date; from?: Date; actorUserId?: string; action?: string; resourceType?: string; q?: string },
    scope: WorkspaceScope,
  ): Promise<Prisma.AuditLogWhereInput> {
    return {
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
                // Searching "enzo" finds what Enzo did.
                { actorUserId: { in: await this.userIdsMatching(params.q) } },
              ],
            }
          : {},
        { workspaceId: scope.workspaceId },
      ],
    };
  }

  /**
   * Platform admins (superusers) only - see AuditLogsController.remove. The
   * journal is the record of who did what, so its own purge is recorded
   * right after: the trace of the deletion is the one entry that survives it.
   */
  async remove(
    params: { ids?: string[]; from?: Date; actorUserId?: string; resourceType?: string; q?: string },
    scope: WorkspaceScope,
    actorUserId?: string,
  ) {
    const where: Prisma.AuditLogWhereInput = params.ids
      ? { id: { in: params.ids }, workspaceId: scope.workspaceId }
      : // A sweep by period or filters keeps earlier purge traces: only an
        // explicit, one-by-one delete can remove those.
        { AND: [await this.filterWhere(params, scope), { action: { not: 'audit_log.delete' } }] };
    const { count } = await this.prisma.auditLog.deleteMany({ where });
    if (count > 0) {
      await this.log({
        workspaceId: scope.workspaceId as string,
        actorUserId,
        action: 'audit_log.delete',
        resourceType: 'audit_log',
        details: {
          count,
          ...(params.ids ? {} : { since: params.from?.toISOString() ?? null, actorUserId: params.actorUserId ?? null, resourceType: params.resourceType ?? null, q: params.q ?? null }),
        },
      });
    }
    return { deleted: count };
  }

  // Values for the journal's filter menus, from what this workspace's
  // journal actually contains.
  async facets(scope: WorkspaceScope) {
    const where = { workspaceId: scope.workspaceId };
    // groupBy runs as SQL GROUP BY; Prisma's `distinct` would read every
    // journal row of the workspace into memory and dedupe there.
    const [actions, resourceTypes, actorRows] = await Promise.all([
      this.prisma.auditLog.groupBy({ by: ['action'], where, orderBy: { action: 'asc' } }),
      this.prisma.auditLog.groupBy({ by: ['resourceType'], where, orderBy: { resourceType: 'asc' } }),
      this.prisma.auditLog.groupBy({ by: ['actorUserId'], where: { ...where, actorUserId: { not: null } } }),
    ]);
    const users = await this.prisma.user.findMany({
      where: { id: { in: actorRows.map((row) => row.actorUserId as string) } },
      select: { id: true, name: true, email: true },
    });
    return {
      actions: actions.map((row) => row.action),
      resourceTypes: resourceTypes.map((row) => row.resourceType),
      actors: users
        .map((user) => ({ id: user.id, name: actorDisplayName(user), email: user.email }))
        .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    };
  }

  private async userIdsMatching(q: string): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] },
      select: { id: true },
      take: 50,
    });
    return users.map((user) => user.id);
  }

  private async resolve(items: Array<{ actorUserId: string | null; resourceId: string | null; details: Prisma.JsonValue }>, scope: WorkspaceScope) {
    const actorIds = [...new Set(items.map((item) => item.actorUserId).filter((id): id is string => Boolean(id)))];
    const ids = new Set<string>();
    for (const item of items) {
      if (item.resourceId && ID_PATTERN.test(item.resourceId)) ids.add(item.resourceId);
      collectIds(item.details, ids);
    }
    const idList = [...ids];
    const workspaceId = scope.workspaceId as string;
    const byIds = { id: { in: idList } };
    const named = { id: true, name: true } as const;
    const [users, ...groups] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: [...new Set([...actorIds, ...idList])] } }, select: { id: true, name: true, email: true } }),
      ...(idList.length === 0
        ? []
        : [
            this.prisma.node.findMany({ where: { ...byIds, workspaceId }, select: named }),
            this.prisma.vpnProfile.findMany({ where: { ...byIds, workspaceId }, select: named }),
            this.prisma.apiKey.findMany({ where: { ...byIds, workspaceId }, select: named }),
            this.prisma.mount.findMany({ where: { ...byIds, node: { workspaceId } }, select: named }),
            this.prisma.share.findMany({ where: { ...byIds, node: { workspaceId } }, select: named }),
            this.prisma.syncJob.findMany({ where: { ...byIds, workspaceId }, select: named }),
            this.prisma.migrationTask.findMany({ where: { ...byIds, workspaceId }, select: named }),
            this.prisma.alertRule.findMany({ where: { ...byIds, workspaceId }, select: named }),
            this.prisma.dnsZone.findMany({ where: { ...byIds, workspaceId }, select: named }),
            this.prisma.dnsServerGroup.findMany({ where: { ...byIds, workspaceId }, select: named }),
            this.prisma.pool.findMany({ where: { ...byIds, workspaceId }, select: named }),
            this.prisma.firewallRule.findMany({ where: { ...byIds, workspaceId }, select: named }),
            this.prisma.firewallAddressList.findMany({ where: { ...byIds, workspaceId }, select: named }),
            // The workspace itself (settings changes name it as their resource).
            this.prisma.workspace.findMany({ where: { AND: [{ id: workspaceId }, byIds] }, select: named }),
          ]),
    ]);
    const actors = new Map<string, Actor>(users.map((user) => [user.id, { id: user.id, name: actorDisplayName(user), email: user.email }]));
    const refs = new Map<string, string>();
    for (const group of groups as Array<Array<{ id: string; name: string }>>) {
      for (const row of group) refs.set(row.id, row.name);
    }
    for (const actor of actors.values()) refs.set(actor.id, actor.name);
    return { actors, refs };
  }

  async exportRange(params: { from: Date; to: Date }, scope: WorkspaceScope) {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        createdAt: { gte: params.from, lte: params.to },
        workspaceId: scope.workspaceId,
      },
      orderBy: { createdAt: 'asc' },
      take: EXPORT_ROW_CAP,
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((row) => row.actorUserId).filter((id): id is string => Boolean(id)))] } },
      select: { id: true, name: true, email: true },
    });
    const names = new Map(users.map((user) => [user.id, actorDisplayName(user)]));
    return rows.map(({ snapshot: _snapshot, ...row }) => ({ ...row, actorName: row.actorUserId ? (names.get(row.actorUserId) ?? null) : null }));
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
    // "Before" state, when the change can be undone (HistoryService).
    snapshot?: Prisma.InputJsonValue;
  }) {
    // Changes made with a workspace API key have no user behind them: the
    // key is recorded instead, so the journal still says who did what.
    const apiKey = requestContext.get()?.apiKey;
    const data =
      apiKey && !input.actorUserId
        ? {
            ...input,
            details:
              input.details && typeof input.details === 'object' && !Array.isArray(input.details)
                ? { ...(input.details as Prisma.InputJsonObject), apiKey }
                : input.details === undefined
                  ? { apiKey }
                  : { value: input.details, apiKey },
          }
        : input;
    const entry = await this.prisma.auditLog.create({ data });
    const { snapshot: _snapshot, ...shown } = entry;
    const user = entry.actorUserId
      ? await this.prisma.user.findUnique({ where: { id: entry.actorUserId }, select: { id: true, name: true, email: true } })
      : null;
    this.live.broadcast(
      'audit.new',
      { ...shown, restorable: Boolean(entry.snapshot), actor: user ? { id: user.id, name: actorDisplayName(user), email: user.email } : null },
      input.workspaceId,
    );
    return entry;
  }
}
