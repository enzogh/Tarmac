import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TopologyService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview() {
    const [nodes, pools, shares, mounts, disks] = await Promise.all([
      this.prisma.node.findMany({ orderBy: { createdAt: 'desc' } }),
      this.prisma.pool.findMany({ include: { members: true } }),
      this.prisma.share.findMany({ include: { clients: true } }),
      this.prisma.mount.findMany(),
      this.prisma.disk.findMany(),
    ]);

    return {
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
  }
}
