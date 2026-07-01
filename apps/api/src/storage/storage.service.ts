import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StorageService {
  constructor(private readonly prisma: PrismaService) {}

  private buildForecast(disks: Array<{ capacityGb: number; usedGb: number }>) {
    const totalCapacityGb = disks.reduce((acc, item) => acc + item.capacityGb, 0);
    const totalUsedGb = disks.reduce((acc, item) => acc + item.usedGb, 0);
    const usageRatio = totalCapacityGb > 0 ? totalUsedGb / totalCapacityGb : 0;

    const avgGrowthPerDayGb = Math.max(1, Math.round((totalUsedGb * 0.03 + disks.length) * 10) / 10);
    const remainingGb = Math.max(totalCapacityGb - totalUsedGb, 0);
    const daysToFull = avgGrowthPerDayGb > 0 ? Math.floor(remainingGb / avgGrowthPerDayGb) : null;

    return {
      totalCapacityGb,
      totalUsedGb,
      usageRatio,
      avgGrowthPerDayGb,
      forecast: {
        remainingGb,
        daysToFull,
        projectedFullDate:
          daysToFull !== null ? new Date(Date.now() + daysToFull * 24 * 60 * 60 * 1000).toISOString() : null,
      },
    };
  }

  async forecast(nodeId?: string) {
    const disks = await this.prisma.disk.findMany({
      where: nodeId ? { nodeId } : undefined,
      orderBy: { updatedAt: 'desc' },
    });

    return {
      generatedAt: new Date().toISOString(),
      nodeId: nodeId ?? null,
      ...this.buildForecast(disks),
    };
  }

  async overview(nodeId?: string) {
    const [disks, latestSamples] = await Promise.all([
      this.prisma.disk.findMany({
        where: nodeId ? { nodeId } : undefined,
        include: { node: true },
        orderBy: [{ nodeId: 'asc' }, { mountPath: 'asc' }],
      }),
      this.prisma.metricSample.findMany({
        where: nodeId ? { nodeId } : undefined,
        orderBy: [{ nodeId: 'asc' }, { createdAt: 'desc' }],
        distinct: ['nodeId'],
      }),
    ]);

    const totals = this.buildForecast(disks);
    const networkRx = latestSamples.reduce((acc, sample) => acc + sample.networkRx, 0);
    const networkTx = latestSamples.reduce((acc, sample) => acc + sample.networkTx, 0);
    const ioRead = latestSamples.reduce((acc, sample) => acc + sample.ioRead, 0);
    const ioWrite = latestSamples.reduce((acc, sample) => acc + sample.ioWrite, 0);

    const cpu = latestSamples.length > 0
      ? latestSamples.reduce((acc, sample) => acc + sample.cpu, 0) / latestSamples.length
      : 0;
    const ram = latestSamples.length > 0
      ? latestSamples.reduce((acc, sample) => acc + sample.ram, 0) / latestSamples.length
      : 0;

    return {
      generatedAt: new Date().toISOString(),
      nodeId: nodeId ?? null,
      ...totals,
      metrics: {
        cpu,
        ram,
        networkRx,
        networkTx,
        ioRead,
        ioWrite,
      },
      disks: disks.map((disk) => ({
        id: disk.id,
        nodeId: disk.nodeId,
        nodeName: disk.node?.name ?? disk.nodeId,
        name: disk.name,
        mountPath: disk.mountPath,
        type: disk.type,
        health: disk.health,
        capacityGb: disk.capacityGb,
        usedGb: disk.usedGb,
        usageRatio: disk.capacityGb > 0 ? disk.usedGb / disk.capacityGb : 0,
        updatedAt: disk.updatedAt.toISOString(),
      })),
    };
  }
}
