import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LiveWsServer } from '../live/live.ws';
import { PrismaService } from '../prisma/prisma.service';

const EXPORT_ROW_CAP = 10_000;

@Injectable()
export class AuditLogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly live: LiveWsServer,
  ) {}

  async list(params: {
    before?: Date;
    from?: Date;
    limit?: number;
    actorUserId?: string;
    action?: string;
    resourceType?: string;
    q?: string;
  }) {
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

  exportRange(params: { from: Date; to: Date }) {
    return this.prisma.auditLog.findMany({
      where: { createdAt: { gte: params.from, lte: params.to } },
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
