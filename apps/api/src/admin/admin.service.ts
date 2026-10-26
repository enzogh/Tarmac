import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { defaultWorkspaceLimit } from '../workspaces/workspace-quota';

// Platform-wide administration, superusers only (checked here, not by
// WorkspaceGuard: none of this is scoped to a workspace).
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  async assertSuperuser(userId?: string) {
    const user = userId
      ? await this.prisma.user.findUnique({ where: { id: userId }, select: { isSuperuser: true } })
      : null;
    if (!user?.isSuperuser) {
      throw new ForbiddenException('Réservé aux administrateurs de la plateforme.');
    }
  }

  async listUsers() {
    const [users, created] = await Promise.all([
      this.prisma.user.findMany({
        orderBy: [{ isSuperuser: 'desc' }, { email: 'asc' }],
        select: {
          id: true,
          email: true,
          name: true,
          avatarUrl: true,
          isSuperuser: true,
          canCreateWorkspaces: true,
          workspaceLimit: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { workspaceMemberships: true } },
        },
      }),
      this.prisma.workspace.groupBy({ by: ['createdById'], where: { createdById: { not: null } }, _count: true }),
    ]);
    const createdBy = new Map(created.map((row) => [row.createdById, row._count]));
    const defaultLimit = defaultWorkspaceLimit();
    return {
      defaultLimit,
      users: users.map(({ _count, ...user }) => ({
        ...user,
        membershipCount: _count.workspaceMemberships,
        createdCount: createdBy.get(user.id) ?? 0,
        effectiveLimit: user.workspaceLimit ?? defaultLimit,
      })),
    };
  }

  async updateUserLimit(userId: string, workspaceLimit: number | null, actorUserId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) {
      throw new NotFoundException('Utilisateur introuvable');
    }
    await this.prisma.user.update({ where: { id: userId }, data: { workspaceLimit } });
    this.logger.log(`Workspace limit for ${user.email} set to ${workspaceLimit ?? 'default'} by ${actorUserId}`);
    return { success: true };
  }
}
