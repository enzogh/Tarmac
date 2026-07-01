import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  list(limit = 200) {
    return this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 500),
    });
  }

  log(input: {
    actorUserId?: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    details?: Prisma.InputJsonValue;
  }) {
    return this.prisma.auditLog.create({ data: input });
  }
}
