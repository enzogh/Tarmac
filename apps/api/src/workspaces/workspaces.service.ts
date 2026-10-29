import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { slugify } from '../common/slugify';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceScope, forgetWorkspaceAccess } from '../auth/workspace.guard';
import { VlanService } from '../vlan/vlan.service';
import { workspaceCreationQuota } from './workspace-quota';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { CustomRoleDto, InviteMemberDto, MemberAccessDto, UpdateCustomRoleDto } from './dto/member-access.dto';
import { API_KEY_SCOPES, normalizeScopes } from '../api-keys/api-key-token';
import { alertEmailAddress } from '../mail/alert-recipients';
import { MailService, RenderedMail } from '../mail/mail.service';
import { renderOwnershipTransfer } from '../mail/templates/ownership-transfer';
import { renderWorkspaceInvitation } from '../mail/templates/workspace-invitation';
import { memberRoleDescription, memberRoleLabel } from './member-roles';

// 10.16.0.0/16 .. 10.31.0.0/16 - see vlan.service.ts's WORKSPACE_SUBNET_BASE_OCTET,
// which must stay in sync with this cap.
const MAX_WORKSPACE_SUBNETS = 16;
const MAX_SUBNET_ALLOCATION_ATTEMPTS = 5;

// Every workspace's pages live under /<slug>/dashboard/... (see the web
// app's app/[workspace] route) - a slug matching one of the frontend's own
// top-level static routes would be permanently unreachable (shadowed by the
// real route) or would shadow that route for everyone, depending on
// Next.js's resolution order. Kept in sync by hand with apps/web/app/*.
const RESERVED_WORKSPACE_SLUGS = new Set(['login', 'docs', 'workspaces', 'api', 'admin']);

// How long an emailed invitation waits for a first sign-in.
const INVITATION_TTL_DAYS = 30;

const MEMBER_USER_SELECT = { id: true, email: true, name: true, avatarUrl: true } as const;

export type WorkspaceHealth = 'empty' | 'ok' | 'warning' | 'critical';

@Injectable()
export class WorkspacesService {
  private readonly logger = new Logger(WorkspacesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly vlanService: VlanService,
    private readonly mailService: MailService,
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

    const membershipByWorkspaceId = new Map<string, { role: string; permissions: string[] }>();
    if (userId) {
      const memberships = await this.prisma.workspaceMembership.findMany({
        where: { userId, workspaceId: { in: workspaces.map((w) => w.id) } },
        select: { workspaceId: true, role: true, permissions: true },
      });
      for (const membership of memberships) {
        membershipByWorkspaceId.set(membership.workspaceId, membership);
      }
    }

    // At-a-glance health for the "Mes workspaces" home page.
    const ids = workspaces.map((w) => w.id);
    const ownerIds = [...new Set(workspaces.map((w) => w.createdById).filter((id): id is string => !!id))];
    const [nodeStats, alertStats, owners] = await Promise.all([
      this.prisma.node.groupBy({ by: ['workspaceId', 'status'], where: { workspaceId: { in: ids } }, _count: true }),
      this.prisma.alert.groupBy({
        by: ['workspaceId', 'severity'],
        where: { workspaceId: { in: ids }, status: { not: 'resolved' } },
        _count: true,
      }),
      this.prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true, email: true } }),
    ]);
    const ownerById = new Map(owners.map((owner) => [owner.id, owner]));

    return workspaces.map(({ _count, ...workspace }) => {
      const membership = membershipByWorkspaceId.get(workspace.id);
      const unrestricted = scope.isPlatformAdmin || membership?.role === 'owner';
      const nodes = nodeStats.filter((row) => row.workspaceId === workspace.id);
      const nodesTotal = nodes.reduce((sum, row) => sum + row._count, 0);
      const nodesOnline = nodes.filter((row) => row.status === 'online').reduce((sum, row) => sum + row._count, 0);
      const alerts = alertStats.filter((row) => row.workspaceId === workspace.id);
      const alertsOpen = alerts.reduce((sum, row) => sum + row._count, 0);
      const alertsSevere = alerts.filter((row) => row.severity === 'critical' || row.severity === 'high').reduce((sum, row) => sum + row._count, 0);
      const health: WorkspaceHealth =
        nodesTotal === 0
          ? 'empty'
          : alertsSevere > 0 || nodesOnline === 0
            ? 'critical'
            : alertsOpen > 0 || nodesOnline < nodesTotal
              ? 'warning'
              : 'ok';
      const owner = workspace.createdById ? ownerById.get(workspace.createdById) : undefined;
      return {
        ...workspace,
        memberCount: _count.memberships,
        isOwner: !!userId && workspace.createdById === userId,
        owner: owner ? { id: owner.id, name: owner.name, email: owner.email } : null,
        health: { status: health, nodesTotal, nodesOnline, alertsOpen, alertsSevere },
        myRole: scope.isPlatformAdmin ? 'owner' : (membership?.role ?? null),
        // What the frontend hides or marks read-only; WorkspaceGuard enforces it.
        myPermissions: unrestricted ? [...API_KEY_SCOPES] : normalizeScopes(membership?.permissions ?? []),
      };
    });
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
          data: { name: dto.name, slug, subnetIndex, createdById: actorUserId },
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

  // Counts the workspaces this user created that still exist, so deleting
  // one frees a slot.
  async assertCreationQuota(userId?: string) {
    const quota = userId ? await workspaceCreationQuota(this.prisma, userId) : null;
    if (!quota) {
      throw new ForbiddenException("Votre compte n'est pas autorisé à créer un workspace.");
    }
    if (quota.used >= quota.limit) {
      throw new ForbiddenException(
        `Vous avez atteint la limite de ${quota.limit} workspace${quota.limit > 1 ? 's' : ''} créé${quota.limit > 1 ? 's' : ''}. Supprimez-en un ou demandez à un administrateur.`,
      );
    }
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

  // Name, slug and Authentik group. subnetIndex stays fixed: nodes' private
  // IPs are carved out of it. The slug is only the URL segment - agents,
  // guards and every query go by workspace id, and the Default workspace is
  // recognised by isDefault/DEFAULT_WORKSPACE_ID, never by its slug - so it
  // can change, Default included. The old slug is kept in previousSlugs so
  // bookmarks and alert e-mails still land on the workspace. Owners can
  // reconfigure their own workspace, same authority tier as member
  // management - only workspace *creation* stays platform-admin-only.
  async update(workspaceId: string, dto: UpdateWorkspaceDto, scope: WorkspaceScope, actorUserId?: string) {
    const workspace = await this.assertExists(workspaceId);
    await this.assertCanManageMembers(workspaceId, scope, actorUserId);
    // Linking an Authentik group makes everyone in it a member at their next
    // login: a workspace owner could otherwise pull the whole access group
    // (or any group) into their workspace.
    if (dto.ssoGroupClaim !== undefined && !scope.isPlatformAdmin) {
      throw new ForbiddenException('Seul un administrateur de la plateforme peut lier un groupe Authentik à un workspace.');
    }
    if (dto.name === undefined && dto.ssoGroupClaim === undefined && dto.slug === undefined && dto.weeklyReportEnabled === undefined) {
      throw new BadRequestException('Nothing to update');
    }

    const slugChanged = dto.slug !== undefined && dto.slug !== workspace.slug;
    if (slugChanged) await this.assertSlugAvailable(dto.slug as string, workspaceId);
    const previousSlugs = slugChanged
      ? [...new Set([...workspace.previousSlugs, workspace.slug])].filter((value) => value !== dto.slug)
      : undefined;

    try {
      const [updated] = await this.prisma.$transaction([
        this.prisma.workspace.update({
          where: { id: workspaceId },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.ssoGroupClaim !== undefined ? { ssoGroupClaim: dto.ssoGroupClaim.trim() || null } : {}),
            ...(slugChanged ? { slug: dto.slug, previousSlugs } : {}),
            ...(dto.weeklyReportEnabled !== undefined ? { weeklyReportEnabled: dto.weeklyReportEnabled } : {}),
          },
        }),
        // The Vlan was named after the slug when it was provisioned; keep the
        // two in step (its name is only a display/lookup alias, never sent
        // to agents).
        ...(slugChanged
          ? [this.prisma.vlan.updateMany({ where: { workspaceId, name: workspace.slug }, data: { name: dto.slug } })]
          : []),
      ]);
      await this.auditLogsService.log({
        workspaceId,
        actorUserId,
        action: 'workspace.update',
        resourceType: 'workspace',
        resourceId: workspaceId,
        details: {
          ...(dto as unknown as Prisma.InputJsonObject),
          ...(slugChanged ? { previousSlug: workspace.slug } : {}),
          ...(dto.name !== undefined && dto.name.trim() !== workspace.name ? { previousName: workspace.name } : {}),
        },
      });
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = String((error.meta as { target?: unknown } | undefined)?.target ?? '');
        if (target.includes('slug') || target.includes('name')) {
          throw new ConflictException('Ce slug est déjà utilisé.');
        }
        throw new ConflictException('Un autre workspace est déjà associé à ce groupe Authentik.');
      }
      throw error;
    }
  }

  // A slug must not shadow a frontend route, nor collide with another
  // workspace's current slug, old slugs (still redirecting there) or Vlan.
  private async assertSlugAvailable(slug: string, workspaceId: string) {
    if (RESERVED_WORKSPACE_SLUGS.has(slug)) {
      throw new ConflictException(`« ${slug} » est réservé par l'application et ne peut pas servir de slug.`);
    }
    const [taken, vlan] = await Promise.all([
      this.prisma.workspace.findFirst({
        where: { id: { not: workspaceId }, OR: [{ slug }, { previousSlugs: { has: slug } }] },
        select: { name: true },
      }),
      this.prisma.vlan.findFirst({ where: { name: slug, workspaceId: { not: workspaceId } }, select: { id: true } }),
    ]);
    if (taken) throw new ConflictException(`Ce slug est déjà utilisé (ou l'a été) par « ${taken.name} ».`);
    if (vlan) throw new ConflictException('Ce slug est déjà utilisé par le réseau privé d’un autre workspace.');
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
    const workspace = await this.assertExists(workspaceId);
    await this.assertCanManageMembers(workspaceId, scope, userId);
    const members = await this.prisma.workspaceMembership.findMany({
      where: { workspaceId },
      include: { user: { select: MEMBER_USER_SELECT }, customRole: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((member) => ({ ...member, isOwner: member.userId === workspace.createdById }));
  }

  // Adds an existing account straight away, or - for an address that has
  // never signed in - records an invitation that becomes a membership at
  // their first SSO login (AuthService.acceptPendingInvitations). Either way
  // the person gets an email saying what they were given and what to do.
  async inviteByEmail(workspaceId: string, dto: InviteMemberDto, scope: WorkspaceScope, actorUserId?: string) {
    const workspace = await this.assertExists(workspaceId);
    await this.assertCanManageMembers(workspaceId, scope, actorUserId);

    const normalizedEmail = dto.email.trim().toLowerCase();
    const access = await this.resolveAccess(workspaceId, dto);
    const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (!user) {
      const existingInvite = await this.prisma.workspaceInvitation.findUnique({
        where: { workspaceId_email: { workspaceId, email: normalizedEmail } },
      });
      if (existingInvite) {
        throw new ConflictException(`${normalizedEmail} a déjà une invitation en attente : renvoyez-la depuis la liste.`);
      }
      const invitation = await this.prisma.workspaceInvitation.create({
        data: {
          workspaceId,
          email: normalizedEmail,
          role: access.role,
          permissions: access.permissions,
          customRoleId: access.customRoleId,
          invitedById: actorUserId,
          expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000),
        },
        include: { customRole: { select: { id: true, name: true } } },
      });
      await this.auditLogsService.log({
        workspaceId,
        actorUserId,
        action: 'workspace.invitation.create',
        resourceType: 'workspace',
        resourceId: workspaceId,
        details: { email: normalizedEmail, role: access.role, customRole: invitation.customRole?.name ?? null },
      });
      const emailed = await this.sendInvitationEmail(workspace, invitation, actorUserId);
      return { status: 'invited' as const, invitation: { ...invitation, emailed } };
    }

    const existing = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: user.id } },
    });
    if (existing) {
      throw new ConflictException(`${user.email} est déjà membre de ce workspace : modifiez son rôle dans la liste.`);
    }
    const membership = await this.prisma.workspaceMembership.create({
      data: { workspaceId, userId: user.id, source: 'manual', ...access },
      include: { user: { select: MEMBER_USER_SELECT }, customRole: { select: { id: true, name: true } } },
    });
    await this.auditLogsService.log({
      workspaceId,
      actorUserId,
      action: 'workspace.member.invite',
      resourceType: 'workspace',
      resourceId: workspaceId,
      details: { userId: user.id, email: user.email, role: access.role, permissions: access.role === 'owner' ? null : membership.permissions },
    });
    const recipient = alertEmailAddress(user);
    const label = memberRoleLabel(membership.role, membership.permissions, membership.customRole?.name);
    const emailed = recipient
      ? await this.sendMail(
          recipient,
          renderWorkspaceInvitation({
            kind: 'added',
            recipient,
            recipientName: user.name,
            workspaceName: workspace.name,
            workspaceSlug: workspace.slug,
            roleLabel: label,
            roleDescription: memberRoleDescription(label),
            invitedBy: await this.displayName(actorUserId),
            frontendUrl: this.mailService.frontendUrl,
          }),
        )
      : false;
    return { status: 'added' as const, membership: { ...membership, isOwner: false }, emailed };
  }

  async listInvitations(workspaceId: string, scope: WorkspaceScope, userId?: string) {
    await this.assertExists(workspaceId);
    await this.assertCanManageMembers(workspaceId, scope, userId);
    const invitations = await this.prisma.workspaceInvitation.findMany({
      where: { workspaceId },
      include: { customRole: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const inviterIds = [...new Set(invitations.map((invitation) => invitation.invitedById).filter((id): id is string => !!id))];
    const inviters = await this.prisma.user.findMany({ where: { id: { in: inviterIds } }, select: { id: true, name: true, email: true } });
    const inviterName = new Map(inviters.map((inviter) => [inviter.id, inviter.name || inviter.email]));
    return invitations.map((invitation) => ({
      ...invitation,
      invitedBy: invitation.invitedById ? (inviterName.get(invitation.invitedById) ?? null) : null,
      expired: invitation.expiresAt < new Date(),
    }));
  }

  // Sends the email again and gives the invitation a fresh validity period.
  async resendInvitation(workspaceId: string, invitationId: string, scope: WorkspaceScope, actorUserId?: string) {
    const workspace = await this.assertExists(workspaceId);
    await this.assertCanManageMembers(workspaceId, scope, actorUserId);
    const found = await this.prisma.workspaceInvitation.findFirst({ where: { id: invitationId, workspaceId } });
    if (!found) throw new NotFoundException('Invitation introuvable');
    const invitation = await this.prisma.workspaceInvitation.update({
      where: { id: invitationId },
      data: { expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000) },
      include: { customRole: { select: { id: true, name: true } } },
    });
    const emailed = await this.sendInvitationEmail(workspace, invitation, actorUserId);
    if (!emailed) {
      throw new BadRequestException("L'email n'a pas pu partir : l'envoi d'emails n'est pas configuré ou le serveur l'a refusé.");
    }
    return { ...invitation, emailed };
  }

  async revokeInvitation(workspaceId: string, invitationId: string, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertExists(workspaceId);
    await this.assertCanManageMembers(workspaceId, scope, actorUserId);
    const invitation = await this.prisma.workspaceInvitation.findFirst({ where: { id: invitationId, workspaceId } });
    if (!invitation) throw new NotFoundException('Invitation introuvable');
    await this.prisma.workspaceInvitation.delete({ where: { id: invitationId } });
    await this.auditLogsService.log({
      workspaceId,
      actorUserId,
      action: 'workspace.invitation.revoke',
      resourceType: 'workspace',
      resourceId: workspaceId,
      details: { email: invitation.email },
    });
    return { success: true };
  }

  private async sendInvitationEmail(
    workspace: { name: string; slug: string },
    invitation: { id: string; email: string; role: string; permissions: string[]; expiresAt: Date; customRole: { name: string } | null },
    actorUserId?: string,
  ): Promise<boolean> {
    const label = memberRoleLabel(invitation.role, invitation.permissions, invitation.customRole?.name);
    const sent = await this.sendMail(
      invitation.email,
      renderWorkspaceInvitation({
        kind: 'invited',
        recipient: invitation.email,
        workspaceName: workspace.name,
        workspaceSlug: workspace.slug,
        roleLabel: label,
        roleDescription: memberRoleDescription(label),
        invitedBy: await this.displayName(actorUserId),
        expiresAt: invitation.expiresAt,
        frontendUrl: this.mailService.frontendUrl,
      }),
    );
    if (sent) {
      await this.prisma.workspaceInvitation.update({ where: { id: invitation.id }, data: { lastSentAt: new Date() } });
    }
    return sent;
  }

  // Emails are a courtesy here: the membership or invitation exists either
  // way, so a relay that is down or unconfigured only returns false.
  private async sendMail(to: string, mail: RenderedMail): Promise<boolean> {
    if (!this.mailService.isConfigured) return false;
    try {
      await this.mailService.send(to, mail);
      return true;
    } catch (error) {
      this.logger.warn(`Email to ${to} failed: ${error instanceof Error ? error.message : error}`);
      return false;
    }
  }

  private async displayName(userId?: string): Promise<string | null> {
    if (!userId) return null;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
    return user ? user.name || user.email : null;
  }

  // role / permissions / customRoleId as stored: a custom role (which must
  // belong to this workspace) dictates the permissions of a "member".
  private async resolveAccess(
    workspaceId: string,
    dto: MemberAccessDto,
    current?: { role: string; permissions: string[]; customRoleId: string | null },
  ): Promise<{ role: string; permissions: string[]; customRoleId: string | null }> {
    const role = dto.role ?? current?.role ?? 'member';
    if (role === 'owner') {
      return { role, permissions: [...API_KEY_SCOPES], customRoleId: null };
    }
    const customRoleId = dto.customRoleId !== undefined ? dto.customRoleId : dto.permissions ? null : (current?.customRoleId ?? null);
    if (customRoleId) {
      const customRole = await this.prisma.workspaceCustomRole.findFirst({ where: { id: customRoleId, workspaceId } });
      if (!customRole) throw new BadRequestException("Ce rôle n'existe pas (ou plus) dans ce workspace.");
      return { role, permissions: customRole.permissions, customRoleId };
    }
    const permissions = dto.permissions ? normalizeScopes(dto.permissions) : (current?.permissions ?? [...API_KEY_SCOPES]);
    return { role, permissions, customRoleId: null };
  }

  // --- custom roles -------------------------------------------------------

  async listCustomRoles(workspaceId: string, scope: WorkspaceScope, userId?: string) {
    await this.assertExists(workspaceId);
    await this.assertCanManageMembers(workspaceId, scope, userId);
    const roles = await this.prisma.workspaceCustomRole.findMany({
      where: { workspaceId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { memberships: true, invitations: true } } },
    });
    return roles.map(({ _count, ...role }) => ({ ...role, memberCount: _count.memberships, invitationCount: _count.invitations }));
  }

  async createCustomRole(workspaceId: string, dto: CustomRoleDto, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertExists(workspaceId);
    await this.assertCanManageMembers(workspaceId, scope, actorUserId);
    try {
      const role = await this.prisma.workspaceCustomRole.create({
        data: { workspaceId, name: dto.name.trim(), description: dto.description?.trim() || null, permissions: normalizeScopes(dto.permissions) },
      });
      await this.auditLogsService.log({
        workspaceId,
        actorUserId,
        action: 'workspace.role.create',
        resourceType: 'workspace',
        resourceId: workspaceId,
        details: { name: role.name, permissions: role.permissions },
      });
      return { ...role, memberCount: 0, invitationCount: 0 };
    } catch (error) {
      throw this.roleNameConflict(error);
    }
  }

  // Members following the role get its new permissions at once.
  async updateCustomRole(workspaceId: string, roleId: string, dto: UpdateCustomRoleDto, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertExists(workspaceId);
    await this.assertCanManageMembers(workspaceId, scope, actorUserId);
    const existing = await this.prisma.workspaceCustomRole.findFirst({ where: { id: roleId, workspaceId } });
    if (!existing) throw new NotFoundException('Rôle introuvable');
    const permissions = dto.permissions ? normalizeScopes(dto.permissions) : undefined;
    try {
      const [role] = await this.prisma.$transaction([
        this.prisma.workspaceCustomRole.update({
          where: { id: roleId },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.description !== undefined ? { description: dto.description.trim() || null } : {}),
            ...(permissions ? { permissions } : {}),
          },
        }),
        ...(permissions
          ? [
              this.prisma.workspaceMembership.updateMany({ where: { customRoleId: roleId, role: 'member' }, data: { permissions } }),
              this.prisma.workspaceInvitation.updateMany({ where: { customRoleId: roleId }, data: { permissions } }),
            ]
          : []),
      ]);
      if (permissions) forgetWorkspaceAccess();
      await this.auditLogsService.log({
        workspaceId,
        actorUserId,
        action: 'workspace.role.update',
        resourceType: 'workspace',
        resourceId: workspaceId,
        details: { name: role.name, ...(dto.name && dto.name.trim() !== existing.name ? { previousName: existing.name } : {}), ...(permissions ? { permissions } : {}) },
      });
      return role;
    } catch (error) {
      throw this.roleNameConflict(error);
    }
  }

  // Members keep the permissions they had, now shown as "Personnalisé".
  async deleteCustomRole(workspaceId: string, roleId: string, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertExists(workspaceId);
    await this.assertCanManageMembers(workspaceId, scope, actorUserId);
    const role = await this.prisma.workspaceCustomRole.findFirst({ where: { id: roleId, workspaceId } });
    if (!role) throw new NotFoundException('Rôle introuvable');
    await this.prisma.workspaceCustomRole.delete({ where: { id: roleId } });
    await this.auditLogsService.log({
      workspaceId,
      actorUserId,
      action: 'workspace.role.delete',
      resourceType: 'workspace',
      resourceId: workspaceId,
      details: { name: role.name },
    });
    return { success: true };
  }

  private roleNameConflict(error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictException('Un rôle porte déjà ce nom dans ce workspace.');
    }
    return error;
  }

  // --- ownership ----------------------------------------------------------

  // Hands the workspace (and the slot it takes in a creation quota) to
  // another member, who becomes an administrator. Allowed to the current
  // owner, to administrators of workspaces that predate ownership, and to
  // platform admins - the only ones who may exceed the new owner's quota,
  // e.g. when someone leaves the company.
  async transferOwnership(
    workspaceId: string,
    newOwnerId: string,
    scope: Pick<WorkspaceScope, 'isPlatformAdmin'>,
    actorUserId?: string,
    keepAdmin = true,
  ) {
    const workspace = await this.assertExists(workspaceId);
    if (!scope.isPlatformAdmin) {
      const actorMembership = actorUserId
        ? await this.prisma.workspaceMembership.findUnique({ where: { workspaceId_userId: { workspaceId, userId: actorUserId } } })
        : null;
      const allowed = workspace.createdById ? workspace.createdById === actorUserId : actorMembership?.role === 'owner';
      if (!allowed) throw new ForbiddenException('Seul le propriétaire du workspace peut transférer sa propriété.');
    }
    if (workspace.createdById === newOwnerId) {
      throw new BadRequestException('Cette personne est déjà propriétaire du workspace.');
    }

    const target = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: newOwnerId } },
      include: { user: { select: { id: true, email: true, name: true, internalEmail: true, isSuperuser: true, disabledAt: true } } },
    });
    if (!target) throw new BadRequestException('Le nouveau propriétaire doit d’abord être membre du workspace.');
    if (target.user.disabledAt) throw new BadRequestException('Ce compte est désactivé : il ne peut pas recevoir la propriété.');

    if (!scope.isPlatformAdmin && !target.user.isSuperuser) {
      const quota = await workspaceCreationQuota(this.prisma, newOwnerId);
      if (!quota) {
        throw new ForbiddenException(`${target.user.email} ne peut pas posséder de workspace (hors du groupe d'accès Tarmac). Demandez à un administrateur de la plateforme.`);
      }
      if (quota.used >= quota.limit) {
        throw new ForbiddenException(
          `${target.user.email} a déjà atteint sa limite de ${quota.limit} workspace${quota.limit > 1 ? 's' : ''}. Un administrateur de la plateforme peut augmenter sa limite.`,
        );
      }
    }

    const previousOwnerId = workspace.createdById;
    await this.prisma.$transaction([
      this.prisma.workspace.update({ where: { id: workspaceId }, data: { createdById: newOwnerId } }),
      this.prisma.workspaceMembership.update({
        where: { id: target.id },
        data: { role: 'owner', permissions: [...API_KEY_SCOPES], customRoleId: null },
      }),
      ...(previousOwnerId && !keepAdmin
        ? [
            this.prisma.workspaceMembership.updateMany({
              where: { workspaceId, userId: previousOwnerId },
              data: { role: 'member', permissions: [...API_KEY_SCOPES], customRoleId: null },
            }),
          ]
        : []),
    ]);
    forgetWorkspaceAccess();
    await this.auditLogsService.log({
      workspaceId,
      actorUserId,
      action: 'workspace.transfer',
      resourceType: 'workspace',
      resourceId: workspaceId,
      details: { from: previousOwnerId, to: newOwnerId, email: target.user.email, keepAdmin },
    });

    const recipient = alertEmailAddress(target.user);
    if (recipient) {
      await this.sendMail(
        recipient,
        renderOwnershipTransfer({
          recipient,
          recipientName: target.user.name,
          workspaceName: workspace.name,
          workspaceSlug: workspace.slug,
          previousOwner: await this.displayName(previousOwnerId ?? undefined),
          transferredBy: await this.displayName(actorUserId),
          frontendUrl: this.mailService.frontendUrl,
        }),
      );
    }
    return { success: true, ownerId: newOwnerId };
  }

  async updateMember(workspaceId: string, userId: string, dto: MemberAccessDto, scope: WorkspaceScope, actorUserId?: string) {
    await this.assertExists(workspaceId);
    await this.assertCanManageMembers(workspaceId, scope, actorUserId);

    const target = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      include: { user: { select: { email: true } } },
    });
    if (!target) throw new NotFoundException("Cette personne n'est pas membre de ce workspace.");
    // Nobody narrows their own access: it's how an owner locks themselves
    // (and possibly everyone) out of administration.
    if (userId === actorUserId) {
      throw new ForbiddenException('Vous ne pouvez pas modifier votre propre rôle. Demandez à un autre administrateur.');
    }
    const access = await this.resolveAccess(workspaceId, dto, target);
    const role = access.role;
    if (target.role === 'owner' && role !== 'owner') {
      const owners = await this.prisma.workspaceMembership.count({ where: { workspaceId, role: 'owner' } });
      if (owners <= 1) {
        throw new ForbiddenException('Impossible de retirer le rôle administrateur au dernier administrateur du workspace.');
      }
    }
    const permissions = access.permissions;
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { createdById: true } });
    if (workspace?.createdById === userId && role !== 'owner') {
      throw new ForbiddenException('Le propriétaire reste administrateur : transférez d’abord la propriété à quelqu’un d’autre.');
    }

    const updated = await this.prisma.workspaceMembership.update({
      where: { id: target.id },
      data: access,
      include: { user: { select: MEMBER_USER_SELECT }, customRole: { select: { id: true, name: true } } },
    });
    forgetWorkspaceAccess(updated.userId);
    await this.auditLogsService.log({
      workspaceId,
      actorUserId,
      action: 'workspace.member.update',
      resourceType: 'workspace',
      resourceId: workspaceId,
      details: {
        userId,
        email: target.user.email,
        ...(role !== target.role ? { roleBefore: target.role, role } : { role }),
        ...(role === 'owner' ? {} : { permissions }),
        ...(updated.customRole ? { customRole: updated.customRole.name } : {}),
      },
    });
    return { ...updated, isOwner: false };
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

    // Whoever manages the workspace can't remove themselves - an owner
    // membership, but also a platform admin, whom the UI presents as owner
    // whatever their membership row says. Doing so would either orphan the
    // workspace or silently lock them out of something they administer.
    // Deleting the whole workspace (see deleteWorkspace below) is the
    // deliberate, explicit way to walk away from it entirely.
    const target = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    });
    if (userId === actorUserId && (target?.role === 'owner' || scope.isPlatformAdmin)) {
      throw new ForbiddenException(
        "Vous gérez ce workspace : vous ne pouvez pas vous en retirer vous-même. Supprimez le workspace, ou demandez à un autre propriétaire de le faire.",
      );
    }
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { createdById: true } });
    if (workspace?.createdById === userId) {
      throw new ForbiddenException('Impossible de retirer le propriétaire du workspace : transférez d’abord la propriété.');
    }
    // Nor can anyone remove its last owner, which would leave it without
    // anyone able to manage it short of a platform admin.
    if (target?.role === 'owner') {
      const owners = await this.prisma.workspaceMembership.count({ where: { workspaceId, role: 'owner' } });
      if (owners <= 1) {
        throw new ForbiddenException('Impossible de retirer le dernier propriétaire du workspace.');
      }
    }

    await this.prisma.workspaceMembership.deleteMany({ where: { workspaceId, userId } });
    forgetWorkspaceAccess(userId);
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

    // Logged first: AuditLog.workspaceId references the workspace, so an
    // entry written after the delete fails its foreign key. The delete then
    // sets it to null (onDelete: SetNull) and resourceId keeps the id.
    await this.auditLogsService.log({
      workspaceId,
      actorUserId,
      action: 'workspace.delete',
      resourceType: 'workspace',
      resourceId: workspaceId,
      details: { name: workspace.name, slug: workspace.slug },
    });

    await this.prisma.$transaction([
      this.prisma.vlan.deleteMany({ where: { workspaceId } }),
      this.prisma.workspace.delete({ where: { id: workspaceId } }),
    ]);
    forgetWorkspaceAccess();
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
