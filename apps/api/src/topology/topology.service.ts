import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// This endpoint is polled every 5s by every open dashboard tab, but the topology graph
// (nodes/pools/shares/mounts/disks) only actually changes on create/delete/config actions —
// a short cache collapses concurrent polls into one set of DB round trips instead of rebuilding
// the full graph from 5 unbounded queries on every single request.
const OVERVIEW_CACHE_TTL_MS = 4_000;

@Injectable()
export class TopologyService {
  private overviewCache: { data: unknown; expiresAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async getOverview() {
    if (this.overviewCache && this.overviewCache.expiresAt > Date.now()) {
      return this.overviewCache.data;
    }

    const [nodes, pools, shares, mounts, disks] = await Promise.all([
      this.prisma.node.findMany({ orderBy: { createdAt: 'desc' } }),
      this.prisma.pool.findMany({ include: { members: true } }),
      this.prisma.share.findMany({ include: { clients: true } }),
      this.prisma.mount.findMany(),
      this.prisma.disk.findMany(),
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

    this.overviewCache = { data: overview, expiresAt: Date.now() + OVERVIEW_CACHE_TTL_MS };
    return overview;
  }
}
