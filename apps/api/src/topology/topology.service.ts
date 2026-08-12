import { Injectable } from '@nestjs/common';
import { scopeWhere, scopeWhereViaNode, WorkspaceScope } from '../auth/workspace.guard';
import { PrismaService } from '../prisma/prisma.service';

// This endpoint is polled every 5s by every open dashboard tab, but the topology graph
// (nodes/pools/shares/mounts/disks) only actually changes on create/delete/config actions —
// a short cache collapses concurrent polls into one set of DB round trips instead of rebuilding
// the full graph from 5 unbounded queries on every single request. Keyed by workspace (or
// '__all__' for a platform admin with no workspace selected) so one tenant's cached view can
// never be served back to another.
const OVERVIEW_CACHE_TTL_MS = 4_000;

@Injectable()
export class TopologyService {
  private overviewCache = new Map<string, { data: unknown; expiresAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async getOverview(scope: WorkspaceScope) {
    const cacheKey = scope.workspaceId ?? '__none__';
    const cached = this.overviewCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const [nodes, pools, shares, mounts, disks] = await Promise.all([
      this.prisma.node.findMany({ where: scopeWhere(scope), orderBy: { createdAt: 'desc' } }),
      this.prisma.pool.findMany({ where: scopeWhere(scope), include: { members: true } }),
      this.prisma.share.findMany({ where: scopeWhere(scope), include: { clients: true } }),
      this.prisma.mount.findMany({ where: scopeWhere(scope) }),
      this.prisma.disk.findMany({ where: scopeWhereViaNode(scope) }),
    ]);

    const overview = {
      generatedAt: new Date().toISOString(),
      nodes,
      edges: {
        poolMembers: pools.flatMap((pool) =>
          pool.members.map((member) => ({ poolId: pool.id, nodeId: member.nodeId, role: member.role })),
        ),
        shares: shares.filter((item) => item.nodeId).map((item) => ({ shareId: item.id, nodeId: item.nodeId })),
        mounts: mounts.filter((item) => item.nodeId).map((item) => ({ mountId: item.id, nodeId: item.nodeId })),
      },
      pools,
      shares,
      mounts,
      disks,
    };

    this.overviewCache.set(cacheKey, { data: overview, expiresAt: Date.now() + OVERVIEW_CACHE_TTL_MS });
    return overview;
  }
}
