import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthentikAccessSyncService } from '../auth/authentik-access-sync.service';
import { SessionValidityService } from '../auth/session-validity.service';
import { alertEmailAddress, internalMailDomain } from '../mail/alert-recipients';
import { MailService } from '../mail/mail.service';
import { EMAIL_TEMPLATES } from '../mail/templates/catalog';
import { TARMAC_MARK_CID, TARMAC_MARK_PNG_BASE64 } from '../mail/templates/tarmac-mark';
import { PrismaService } from '../prisma/prisma.service';
import { memberRoleLabel } from '../workspaces/member-roles';
import { defaultWorkspaceLimit, envWorkspaceLimit, WORKSPACE_LIMIT_SETTING } from '../workspaces/workspace-quota';
import { WorkspacesService } from '../workspaces/workspaces.service';

// Platform-wide administration, superusers only (checked here, not by
// WorkspaceGuard: none of this is scoped to a workspace). Changes are kept
// in AuditLog without a workspace (resourceType "user" / "platform").
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly accessSync: AuthentikAccessSyncService,
    private readonly sessionValidity: SessionValidityService,
    private readonly workspacesService: WorkspacesService,
  ) {}

  async assertSuperuser(userId?: string) {
    const user = userId
      ? await this.prisma.user.findUnique({ where: { id: userId }, select: { isSuperuser: true } })
      : null;
    if (!user?.isSuperuser) {
      throw new ForbiddenException('Réservé aux administrateurs de la plateforme.');
    }
  }

  async listUsers() {
    const [users, created, defaultLimit] = await Promise.all([
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
          disabledAt: true,
          accessCheckedAt: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { workspaceMemberships: true } },
        },
      }),
      this.prisma.workspace.groupBy({ by: ['createdById'], where: { createdById: { not: null } }, _count: true }),
      defaultWorkspaceLimit(this.prisma),
    ]);
    const createdBy = new Map(created.map((row) => [row.createdById, row._count]));
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

  // Everything the user drawer shows: their workspaces (with who else is in
  // each, to pick a new owner) and the history of admin changes.
  async getUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, isSuperuser: true, disabledAt: true },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');

    const [memberships, ownedWithoutMembership, history] = await Promise.all([
      this.prisma.workspaceMembership.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        select: {
          role: true,
          permissions: true,
          createdAt: true,
          customRole: { select: { name: true } },
          workspace: { select: { id: true, name: true, slug: true, createdById: true, _count: { select: { memberships: true, nodes: true } } } },
        },
      }),
      this.prisma.workspace.findMany({
        where: { createdById: userId, memberships: { none: { userId } } },
        select: { id: true, name: true, slug: true, _count: { select: { memberships: true, nodes: true } } },
      }),
      this.prisma.auditLog.findMany({
        where: { resourceType: 'user', resourceId: userId },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    ]);

    const actorIds = [...new Set(history.map((entry) => entry.actorUserId).filter((id): id is string => !!id))];
    const actors = await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } });
    const actorName = new Map(actors.map((actor) => [actor.id, actor.name || actor.email]));

    return {
      ...user,
      workspaces: [
        ...memberships.map((membership) => ({
          id: membership.workspace.id,
          name: membership.workspace.name,
          slug: membership.workspace.slug,
          isOwner: membership.workspace.createdById === userId,
          roleLabel: memberRoleLabel(membership.role, membership.permissions, membership.customRole?.name),
          memberCount: membership.workspace._count.memberships,
          nodeCount: membership.workspace._count.nodes,
          joinedAt: membership.createdAt,
        })),
        ...ownedWithoutMembership.map((workspace) => ({
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          isOwner: true,
          roleLabel: null,
          memberCount: workspace._count.memberships,
          nodeCount: workspace._count.nodes,
          joinedAt: null,
        })),
      ],
      history: history.map((entry) => ({
        id: entry.id,
        action: entry.action,
        details: entry.details,
        createdAt: entry.createdAt,
        actor: entry.actorUserId ? (actorName.get(entry.actorUserId) ?? 'Compte supprimé') : null,
      })),
    };
  }

  async updateUser(userId: string, changes: { workspaceLimit?: number | null; disabled?: boolean }, actorUserId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, workspaceLimit: true, disabledAt: true } });
    if (!user) {
      throw new NotFoundException('Utilisateur introuvable');
    }

    if (changes.workspaceLimit !== undefined && changes.workspaceLimit !== user.workspaceLimit) {
      await this.prisma.user.update({ where: { id: userId }, data: { workspaceLimit: changes.workspaceLimit } });
      await this.audit(actorUserId, 'admin.user.limit', userId, { email: user.email, before: user.workspaceLimit, after: changes.workspaceLimit });
      this.logger.log(`Workspace limit for ${user.email} set to ${changes.workspaceLimit ?? 'default'} by ${actorUserId}`);
    }

    if (changes.disabled !== undefined && changes.disabled !== (user.disabledAt !== null)) {
      if (changes.disabled && userId === actorUserId) {
        throw new BadRequestException('Vous ne pouvez pas désactiver votre propre compte.');
      }
      const now = new Date();
      await this.prisma.user.update({
        where: { id: userId },
        data: changes.disabled ? { disabledAt: now, sessionsRevokedAt: now } : { disabledAt: null },
      });
      this.sessionValidity.forget(userId);
      await this.audit(actorUserId, changes.disabled ? 'admin.user.disable' : 'admin.user.enable', userId, { email: user.email });
      this.logger.log(`Account ${user.email} ${changes.disabled ? 'disabled' : 're-enabled'} by ${actorUserId}`);
    }
    return { success: true };
  }

  async getSettings() {
    const setting = await this.prisma.platformSetting.findUnique({ where: { key: WORKSPACE_LIMIT_SETTING } });
    return {
      defaultWorkspaceLimit: await defaultWorkspaceLimit(this.prisma),
      defaultWorkspaceLimitSource: typeof setting?.value === 'number' ? ('admin' as const) : ('environment' as const),
      environmentWorkspaceLimit: envWorkspaceLimit(),
      defaultWorkspaceLimitUpdatedAt: setting?.updatedAt ?? null,
      accessSync: await this.accessSync.status(),
      mail: { configured: this.mailService.isConfigured, from: this.mailService.from },
    };
  }

  async updateSettings(changes: { defaultWorkspaceLimit?: number | null }, actorUserId?: string) {
    if (changes.defaultWorkspaceLimit !== undefined) {
      const before = await defaultWorkspaceLimit(this.prisma);
      if (changes.defaultWorkspaceLimit === null) {
        await this.prisma.platformSetting.deleteMany({ where: { key: WORKSPACE_LIMIT_SETTING } });
      } else {
        await this.prisma.platformSetting.upsert({
          where: { key: WORKSPACE_LIMIT_SETTING },
          create: { key: WORKSPACE_LIMIT_SETTING, value: changes.defaultWorkspaceLimit, updatedById: actorUserId },
          update: { value: changes.defaultWorkspaceLimit, updatedById: actorUserId },
        });
      }
      const after = await defaultWorkspaceLimit(this.prisma);
      await this.audit(actorUserId, 'admin.settings.default-limit', null, { before, after }, 'platform');
    }
    return this.getSettings();
  }

  runAccessSync() {
    if (!this.accessSync.isConfigured) {
      throw new ServiceUnavailableException('La vérification continue des accès n’est pas configurée (jeton API Authentik manquant).');
    }
    return this.accessSync.run();
  }

  // Rendered with sample data. The logo travels as a cid: attachment in real
  // emails; an iframe preview has no attachment, so it's inlined here.
  async listEmailTemplates(actorUserId?: string) {
    const context = await this.previewContext(actorUserId);
    const inlineMark = `data:image/png;base64,${TARMAC_MARK_PNG_BASE64}`;
    return EMAIL_TEMPLATES.map((template) => {
      const mail = template.render(context);
      return {
        id: template.id,
        name: template.name,
        trigger: template.trigger,
        audience: template.audience,
        subject: mail.subject,
        html: mail.html.split(`cid:${TARMAC_MARK_CID}`).join(inlineMark),
        text: mail.text,
      };
    });
  }

  async sendTestEmail(templateId: string, actorUserId?: string) {
    const template = EMAIL_TEMPLATES.find((entry) => entry.id === templateId);
    if (!template) throw new NotFoundException('Modèle introuvable');
    if (!this.mailService.isConfigured) {
      throw new ServiceUnavailableException("L'envoi d'emails n'est pas configuré sur ce serveur.");
    }
    const context = await this.previewContext(actorUserId);
    const mail = template.render(context);
    try {
      await this.mailService.send(context.recipient, { ...mail, subject: `[Test] ${mail.subject}` });
    } catch (error) {
      this.logger.warn(`Template test email to ${context.recipient} failed: ${error instanceof Error ? error.message : error}`);
      throw new ServiceUnavailableException("Le serveur d'envoi a refusé l'email, réessayez dans un instant.");
    }
    return { sentTo: context.recipient };
  }

  transferWorkspace(workspaceId: string, newOwnerId: string, actorUserId?: string) {
    return this.workspacesService.transferOwnership(workspaceId, newOwnerId, { isPlatformAdmin: true }, actorUserId);
  }

  private async previewContext(actorUserId?: string) {
    const actor = actorUserId
      ? await this.prisma.user.findUnique({ where: { id: actorUserId }, select: { email: true, internalEmail: true, name: true } })
      : null;
    return {
      frontendUrl: this.mailService.frontendUrl,
      recipient: (actor && alertEmailAddress(actor)) || actor?.email || 'vous@exemple.fr',
      recipientName: actor?.name ?? null,
      internalDomain: internalMailDomain(),
    };
  }

  private audit(actorUserId: string | undefined, action: string, resourceId: string | null, details: Prisma.InputJsonObject, resourceType = 'user') {
    return this.prisma.auditLog.create({ data: { actorUserId: actorUserId ?? null, action, resourceType, resourceId, details } });
  }
}
