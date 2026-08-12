import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceScope } from '../auth/workspace.guard';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  // Always the caller's full accessible set, regardless of which workspace
  // is currently selected via X-Workspace-Id - this is what populates the
  // switcher, not a single-workspace-scoped read.
  list(scope: WorkspaceScope) {
    return this.prisma.workspace.findMany({
      where: scope.isPlatformAdmin ? {} : { id: { in: scope.allowedWorkspaceIds } },
      orderBy: { createdAt: 'asc' },
    });
  }

  private slugify(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // Subnet/Vlan provisioning (real network isolation) is Phase 2 - this
  // creates a workspace shell only. subnetIndex/ssoGroupClaim stay null
  // until that lands.
  async create(dto: CreateWorkspaceDto, actorUserId?: string) {
    const slug = dto.slug ? this.slugify(dto.slug) : this.slugify(dto.name);
    if (!slug) {
      throw new BadRequestException('Unable to derive a slug from the provided name');
    }

    try {
      const created = await this.prisma.workspace.create({
        data: { name: dto.name, slug },
      });
      await this.auditLogsService.log({
        actorUserId,
        action: 'workspace.create',
        resourceType: 'workspace',
        resourceId: created.id,
        details: { name: created.name, slug: created.slug },
      });
      return created;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A workspace with this slug already exists');
      }
      throw error;
    }
  }

  async listMembers(workspaceId: string) {
    await this.assertExists(workspaceId);
    return this.prisma.workspaceMembership.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, email: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addMember(workspaceId: string, userId: string, actorUserId?: string) {
    await this.assertExists(workspaceId);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const membership = await this.prisma.workspaceMembership.upsert({
      where: { workspaceId_userId: { workspaceId, userId } },
      create: { workspaceId, userId, source: 'manual' },
      update: {},
    });
    await this.auditLogsService.log({
      actorUserId,
      action: 'workspace.member.add',
      resourceType: 'workspace',
      resourceId: workspaceId,
      details: { userId, email: user.email },
    });
    return membership;
  }

  async removeMember(workspaceId: string, userId: string, actorUserId?: string) {
    await this.assertExists(workspaceId);
    await this.prisma.workspaceMembership.deleteMany({ where: { workspaceId, userId } });
    await this.auditLogsService.log({
      actorUserId,
      action: 'workspace.member.remove',
      resourceType: 'workspace',
      resourceId: workspaceId,
      details: { userId },
    });
    return { success: true };
  }

  private async assertExists(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }
    return workspace;
  }
}
