import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StorageService {
  constructor(private readonly prisma: PrismaService) {}

  async forecast() {
    const disks = await this.prisma.disk.findMany({ orderBy: { updatedAt: 'desc' } });
    const totalCapacityGb = disks.reduce((acc, item) => acc + item.capacityGb, 0);
    const totalUsedGb = disks.reduce((acc, item) => acc + item.usedGb, 0);
    const usageRatio = totalCapacityGb > 0 ? totalUsedGb / totalCapacityGb : 0;

    const avgGrowthPerDayGb = Math.max(1, Math.round((totalUsedGb * 0.03 + disks.length) * 10) / 10);
    const remainingGb = Math.max(totalCapacityGb - totalUsedGb, 0);
    const daysToFull = avgGrowthPerDayGb > 0 ? Math.floor(remainingGb / avgGrowthPerDayGb) : null;

    return {
      generatedAt: new Date().toISOString(),
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
}
