import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { slugify } from '../common/slugify';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceScope } from '../auth/workspace.guard';
import { VlanService } from '../vlan/vlan.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';

// 10.16.0.0/16 .. 10.31.0.0/16 - see vlan.service.ts's WORKSPACE_SUBNET_BASE_OCTET,
// which must stay in sync with this cap.
const MAX_WORKSPACE_SUBNETS = 16;
const MAX_SUBNET_ALLOCATION_ATTEMPTS = 5;

// Every workspace's pages live under /<slug>/dashboard/... (see the web
// app's app/[workspace] route) - a slug matching one of the frontend's own
// top-level static routes would be permanently unreachable (shadowed by the
// real route) or would shadow that route for everyone, depending on
// Next.js's resolution order. Kept in sync by hand with apps/web/app/*.
const RESERVED_WORKSPACE_SLUGS = new Set(['login', 'docs', 'workspaces', 'api']);

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly vlanService: VlanService,
  ) {}

  // Always the caller's full accessible set, regardless of which workspace
  // is currently selected via X-Workspace-Id - this is what populates the
  // switcher, not a single-workspace-scoped read. Also annotates each
  // workspace with the caller's own role (so the frontend can decide whether
  // to show member-management actions) and a member count.
  async list(scope: WorkspaceScope, userId?: string) {
    const workspaces = await this.prisma.workspace.findMany({
      where: scope.isPlatformAdmin ? {} : { id: { in: scope.allowedWorkspaceIds } },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { memberships: true } } },
    });

    const roleByWorkspaceId = new Map<string, string>();
    if (userId) {
      const memberships = await this.prisma.workspaceMembership.findMany({
        where: { userId, workspaceId: { in: workspaces.map((w) => w.id) } },
        select: { workspaceId: true, role: true },
      });
      for (const membership of memberships) {
        roleByWorkspaceId.set(membership.workspaceId, membership.role);
      }
    }

    return workspaces.map(({ _count, ...workspace }) => ({
      ...workspace,
      memberCount: _count.memberships,
      myRole: scope.isPlatformAdmin ? 'owner' : (roleByWorkspaceId.get(workspace.id) ?? null),
    }));
  }

  // Allocates the next free subnetIndex (1..MAX_WORKSPACE_SUBNETS) and
  // creates the workspace, then eagerly provisions its Vlan (subnet
  // reserved from creation time, before any node ever joins). Concurrent
  // creations racing for the same index are resolved via the unique
  // constraint on Workspace.subnetIndex + a bounded retry - Postgres's
  // default Read Committed isolation doesn't prevent two transactions
  // computing the same "next" index, so this can't rely on a plain
  // SELECT MAX + INSERT being atomic.
  async create(dto: CreateWorkspaceDto, actorUserId?: string) {
    const slug = dto.slug ? slugify(dto.slug) : slugify(dto.name);
    if (!slug) {
      throw new BadRequestException('Unable to derive a slug from the provided name');
    }
    if (RESERVED_WORKSPACE_SLUGS.has(slug)) {
      throw new ConflictException(`"${slug}" is a reserved slug and can't be used for a workspace`);
    }

    let created: Prisma.WorkspaceGetPayload<Record<string, never>> | undefined;
    for (let attempt = 0; attempt < MAX_SUBNET_ALLOCATION_ATTEMPTS; attempt++) {
      const subnetIndex = await this.nextSubnetIndex();
      try {
        created = await this.prisma.workspace.create({
          data: { name: dto.name, slug, subnetIndex },
        });
        break;
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
          throw error;
        }
        const target = (error.meta?.target as string[] | undefined) ?? [];
        if (target.includes('slug')) {
          throw new ConflictException('A workspace with this slug already exists');
        }
        if (target.includes('subnetIndex') && attempt < MAX_SUBNET_ALLOCATION_ATTEMPTS - 1) {
          continue; // another workspace grabbed this index concurrently - retry with a fresh one
        }
        throw error;
      }
    }
    if (!created) {
      throw new ConflictException('Could not allocate a subnet for this workspace, please retry');
    }

    await this.auditLogsService.log({
      workspaceId: created.id,
      actorUserId,
      action: 'workspace.create',
      resourceType: 'workspace',
      resourceId: created.id,
      details: { name: created.name, slug: created.slug, subnetIndex: created.subnetIndex },
    });

    // The creator becomes this workspace's owner so they can manage its
    // members without also needing to be a platform admin - without this,
    // a non-superuser who somehow creates a workspace would have no
    // membership row at all and couldn't access what they just made.
    if (actorUserId) {
      await this.prisma.workspaceMembership.upsert({
        where: { workspaceId_userId: { workspaceId: created.id, userId: actorUserId } },
        create: { workspaceId: created.id, userId: actorUserId, role: 'owner', source: 'manual' },
        update: { role: 'owner' },
      });
    }

    // Provision the mesh now so the workspace has a reserved subnet/Vlan row
    // even before its first node joins.
    await this.vlanService.getOrCreateVlan(created.id);

    return created;
  }

  private async nextSubnetIndex(): Promise<number> {
    const taken = await this.prisma.workspace.findMany({
      where: { subnetIndex: { not: null } },
      select: { subnetIndex: true },
      orderBy: { subnetIndex: 'asc' },
    });
    const takenSet = new Set(taken.map((w) => w.subnetIndex));
    for (let index = 1; index <= MAX_WORKSPACE_SUBNETS; index++) {
      if (!takenSet.has(index)) return index;
    }
    throw new ConflictException(
      `No subnet available - all ${MAX_WORKSPACE_SUBNETS} workspace subnet slots are in use`,
    );
  }

  // name/ssoGroupClaim only - renaming a workspace or (re)pointing it at an
  // Authentik group is safe post-creation; subnetIndex/slug are not editable
  // here since changing them after nodes/agents already depend on them would
  // require the same careful rollout as initial provisioning. Owners can
  // rename/reconfigure their own workspace, same authority tier as member
  // management - only workspace *creation* stays platform-admin-only.
  async update(workspaceId: string, dto: UpdateWorkspaceDto, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertExists(workspaceId);
    await this.assertCanManageMembers(workspaceId, scope, actorUserId);
    if (dto.name === undefined && dto.ssoGroupClaim === undefined) {
      throw new BadRequestException('Nothing to update');
    }

    try {
      const updated = await this.prisma.workspace.update({
        where: { id: workspaceId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.ssoGroupClaim !== undefined ? { ssoGroupClaim: dto.ssoGroupClaim || null } : {}),
        },
      });
      await this.auditLogsService.log({
        workspaceId,
        actorUserId,
        action: 'workspace.update',
        resourceType: 'workspace',
        resourceId: workspaceId,
        details: dto as unknown as Prisma.InputJsonValue,
      });
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Another workspace is already mapped to this Authentik group');
      }
      throw error;
    }
  }

  // There's no dedicated users module/list endpoint anywhere in the API yet -
  // without this, a platform admin has no way to find a userId to pass to
  // addMember() short of querying the database directly.
  listAllUsers() {
    return this.prisma.user.findMany({
      select: { id: true, email: true, name: true, isSuperuser: true },
      orderBy: { email: 'asc' },
    });
  }

  // Platform admins can manage any workspace's members; otherwise the caller
  // must hold an 'owner' membership row for this specific workspace. Unlike
  // platform-admin gating, this is workspace-scoped - being an owner of one
  // workspace grants nothing for another.
  private async assertCanManageMembers(workspaceId: string, scope: WorkspaceScope, userId?: string) {
    if (scope.isPlatformAdmin) return;
    if (userId) {
      const membership = await this.prisma.workspaceMembership.findUnique({
        where: { workspaceId_userId: { workspaceId, userId } },
      });
      if (membership?.role === 'owner') return;
    }
    throw new ForbiddenException('Workspace owner or platform admin access required');
  }

  async listMembers(workspaceId: string, scope: WorkspaceScope, userId?: string) {
    await this.assertExists(workspaceId);
    await this.assertCanManageMembers(workspaceId, scope, userId);
    return this.prisma.workspaceMembership.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, email: true, name: true, avatarUrl: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  // Adds an existing user (looked up by email) to a workspace. There's no
  // outbound-email infrastructure in this API, so this only works for users
  // who have already logged into Tarmac at least once via SSO - even a
  // first SSO attempt that gets bounced for lacking workspace access still
  // creates the User row (see AuthService.findOrCreateSsoUser), so this
  // covers "invite someone brand new" as long as they've tried logging in
  // once first.
  async inviteByEmail(workspaceId: string, email: string, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertExists(workspaceId);
    await this.assertCanManageMembers(workspaceId, scope, actorUserId);

    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      throw new NotFoundException(
        "Aucun compte trouvé pour cet email. Cette personne doit d'abord se connecter une fois via SSO, puis réessayez.",
      );
    }

    const membership = await this.prisma.workspaceMembership.upsert({
      where: { workspaceId_userId: { workspaceId, userId: user.id } },
      create: { workspaceId, userId: user.id, role: 'member', source: 'manual' },
      update: {},
      include: { user: { select: { id: true, email: true, name: true, avatarUrl: true } } },
    });
    await this.auditLogsService.log({
      workspaceId,
      actorUserId,
      action: 'workspace.member.invite',
      resourceType: 'workspace',
      resourceId: workspaceId,
      details: { userId: user.id, email: user.email },
    });
    return membership;
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
      workspaceId,
      actorUserId,
      action: 'workspace.member.add',
      resourceType: 'workspace',
      resourceId: workspaceId,
      details: { userId, email: user.email },
    });
    return membership;
  }

  async removeMember(workspaceId: string, userId: string, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertExists(workspaceId);
    await this.assertCanManageMembers(workspaceId, scope, actorUserId);

    // An owner can't remove themselves - doing so would either orphan the
    // workspace (no one left who can manage it without platform-admin
    // intervention) or silently lock the owner out of something they still
    // administer. Deleting the whole workspace (see deleteWorkspace below)
    // is the deliberate, explicit way to walk away from it entirely.
    if (userId === actorUserId) {
      const actorMembership = await this.prisma.workspaceMembership.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: actorUserId } },
      });
      if (actorMembership?.role === 'owner') {
        throw new ForbiddenException(
          "Un propriétaire ne peut pas se retirer lui-même. Supprimez le workspace ou transférez d'abord la propriété.",
        );
      }
    }

    await this.prisma.workspaceMembership.deleteMany({ where: { workspaceId, userId } });
    await this.auditLogsService.log({
      workspaceId,
      actorUserId,
      action: 'workspace.member.remove',
      resourceType: 'workspace',
      resourceId: workspaceId,
      details: { userId },
    });
    return { success: true };
  }

  // Deletable only once genuinely empty - every workspace-scoped resource
  // besides Vlan (infra scaffolding provisioned automatically at creation,
  // safe to tear down here) has an onDelete: Restrict FK to Workspace by
  // design (see schema.prisma), so this fails loudly and explicitly rather
  // than silently cascading away a fleet's nodes/pools/alerts. The caller
  // must explicitly remove real resources first - this mirrors how cloud
  // providers refuse to delete a VPC/resource-group that still has things
  // in it.
  async deleteWorkspace(workspaceId: string, scope: WorkspaceScope, actorUserId?: string) {
    const workspace = await this.assertExists(workspaceId);
    await this.assertCanManageMembers(workspaceId, scope, actorUserId);

    if (workspace.isDefault) {
      throw new ForbiddenException('Le workspace par défaut ne peut pas être supprimé.');
    }

    const [nodes, shares, mounts, pools, notificationChannels, alertRules, alerts, syncJobs, migrationTasks] =
      await Promise.all([
        this.prisma.node.count({ where: { workspaceId } }),
        this.prisma.share.count({ where: { workspaceId } }),
        this.prisma.mount.count({ where: { workspaceId } }),
        this.prisma.pool.count({ where: { workspaceId } }),
        this.prisma.notificationChannel.count({ where: { workspaceId } }),
        this.prisma.alertRule.count({ where: { workspaceId } }),
        this.prisma.alert.count({ where: { workspaceId } }),
        this.prisma.syncJob.count({ where: { workspaceId } }),
        this.prisma.migrationTask.count({ where: { workspaceId } }),
      ]);
    const remaining: string[] = [];
    if (nodes > 0) remaining.push(`${nodes} nœud(s)`);
    if (shares > 0) remaining.push(`${shares} partage(s)`);
    if (mounts > 0) remaining.push(`${mounts} montage(s)`);
    if (pools > 0) remaining.push(`${pools} pool(s) de stockage`);
    if (syncJobs > 0) remaining.push(`${syncJobs} job(s) de réplication`);
    if (migrationTasks > 0) remaining.push(`${migrationTasks} migration(s)`);
    if (alertRules > 0) remaining.push(`${alertRules} règle(s) d'alerte`);
    if (alerts > 0) remaining.push(`${alerts} alerte(s)`);
    if (notificationChannels > 0) remaining.push(`${notificationChannels} canal/canaux de notification`);
    if (remaining.length > 0) {
      throw new ConflictException(
        `Ce workspace contient encore : ${remaining.join(', ')}. Supprimez-les d'abord.`,
      );
    }

    await this.prisma.$transaction([
      this.prisma.vlan.deleteMany({ where: { workspaceId } }),
      this.prisma.workspace.delete({ where: { id: workspaceId } }),
    ]);

    await this.auditLogsService.log({
      workspaceId,
      actorUserId,
      action: 'workspace.delete',
      resourceType: 'workspace',
      resourceId: workspaceId,
      details: { name: workspace.name, slug: workspace.slug },
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
