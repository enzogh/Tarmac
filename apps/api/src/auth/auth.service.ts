import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { User } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { alertEmailAddress, alertEmailSource, internalMailDomain } from '../mail/alert-recipients';
import { MailService } from '../mail/mail.service';
import { renderNotificationAddress } from '../mail/templates/notification-address';
import { PrismaService } from '../prisma/prisma.service';
import { workspaceCreationQuota } from '../workspaces/workspace-quota';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { getCandidateJwtSecrets } from './jwt-secrets';

interface JwtPayload {
  sub: string;
  email: string;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
  ) {}

  async onModuleInit() {
    const shouldBootstrap = this.configService.get<string>('ENABLE_DEFAULT_ADMIN', 'false') === 'true';

    if (!shouldBootstrap) {
      return;
    }

    try {
      const email = this.getDefaultAdminEmail();
      const ensured = await this.ensureDefaultAdmin();
      if (ensured) {
        this.logger.log(`Default admin ensured: ${email}`);
      }
    } catch (error) {
      this.logger.warn(`Failed to ensure default admin: ${error instanceof Error ? error.message : error}`);
    }
  }

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();

    let user = await this.prisma.user.findUnique({ where: { email } });
    if (!user && this.shouldBootstrapDefaultAdmin() && email === this.getDefaultAdminEmail()) {
      await this.ensureDefaultAdmin();
      user = await this.prisma.user.findUnique({ where: { email } });
    }

    if (!user) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    const passwordOk = await this.verifyPassword(dto.password, user);
    if (!passwordOk) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    if (!user.isSuperuser) {
      throw new UnauthorizedException('Accès réservé aux administrateurs');
    }
    if (user.disabledAt) {
      throw new UnauthorizedException('Ce compte a été désactivé.');
    }

    return this.issueSession(user);
  }

  async issueSession(user: User) {
    const access_token = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
    });

    return { access_token };
  }

  // Called after a successful Authentik OIDC callback. Links the SSO
  // identity to an existing local user by ssoSubject first (stable across
  // email changes), then by email (so a pre-existing local admin account
  // gets upgraded rather than duplicated), else creates a fresh SSO-only
  // user.
  //
  // canCreateWorkspaces, unlike isSuperuser, follows the access group both
  // ways: losing it only stops new workspace creation, never touches existing
  // memberships.
  //
  // isSuperuser mirrors the claim honestly - it must NEVER be hardcoded true
  // here. Before Phase 3, every caller of this method had already rejected
  // non-superuser claims upstream, so hardcoding true was a no-op; now that
  // ordinary workspace members can complete this same flow, doing so would
  // silently grant every new SSO-provisioned workspace member full platform-
  // admin rights. Demotion (a previously-true isSuperuser going false) is
  // deliberately NOT applied here even when the claim says false - treat
  // that as a possibly-transient IdP/claim-mapping issue and require a
  // manual platform-admin action to actually revoke platform-admin status.
  //
  // internalEmail is refreshed on every login, null included: an address
  // removed from the account in Authentik must stop receiving alerts, which
  // then fall back to `email`. alertAddressChanged tells the caller the
  // resolved alert address differs from before this login, so it can send
  // the "your alerts go here now" confirmation once the login is allowed.
  async findOrCreateSsoUser(claims: {
    sub: string;
    email: string;
    internalEmail: string | null;
    name?: string | null;
    avatarUrl?: string | null;
    isSuperuser: boolean;
    canCreateWorkspaces: boolean;
  }): Promise<{ user: User; alertAddressChanged: boolean }> {
    const email = claims.email.trim().toLowerCase();
    const internalEmail = claims.internalEmail?.trim().toLowerCase() || null;
    const withChange = (user: User, before: User | null) => ({
      user,
      alertAddressChanged: alertEmailAddress(user) !== (before ? alertEmailAddress(before) : null),
    });

    const existingBySubject = await this.prisma.user.findUnique({ where: { ssoSubject: claims.sub } });
    if (existingBySubject) {
      const updated = await this.prisma.user.update({
        where: { id: existingBySubject.id },
        data: {
          email,
          internalEmail,
          name: claims.name ?? existingBySubject.name,
          avatarUrl: claims.avatarUrl ?? existingBySubject.avatarUrl,
          isSuperuser: existingBySubject.isSuperuser || claims.isSuperuser,
          canCreateWorkspaces: claims.canCreateWorkspaces,
        },
      });
      return withChange(updated, existingBySubject);
    }

    const existingByEmail = await this.prisma.user.findUnique({ where: { email } });
    if (existingByEmail) {
      const updated = await this.prisma.user.update({
        where: { id: existingByEmail.id },
        data: {
          ssoSubject: claims.sub,
          internalEmail,
          name: claims.name ?? existingByEmail.name,
          avatarUrl: claims.avatarUrl ?? existingByEmail.avatarUrl,
          isSuperuser: existingByEmail.isSuperuser || claims.isSuperuser,
          canCreateWorkspaces: claims.canCreateWorkspaces,
        },
      });
      return withChange(updated, existingByEmail);
    }

    const created = await this.prisma.user.create({
      data: {
        email,
        internalEmail,
        ssoSubject: claims.sub,
        name: claims.name,
        avatarUrl: claims.avatarUrl,
        isSuperuser: claims.isSuperuser,
        canCreateWorkspaces: claims.canCreateWorkspaces,
      },
    });
    return withChange(created, null);
  }

  // Fire-and-forget from the SSO callback: a slow or unreachable relay must
  // never hold up a login.
  sendAlertAddressConfirmation(user: User): void {
    const recipient = alertEmailAddress(user);
    if (!recipient || !this.mailService.isConfigured || !user.alertEmailsEnabled) return;
    const mail = renderNotificationAddress({
      kind: 'enabled',
      recipient,
      recipientName: user.name,
      source: alertEmailSource(user),
      internalDomain: internalMailDomain(),
      frontendUrl: this.mailService.frontendUrl,
    });
    this.mailService.send(recipient, mail).catch((error) => {
      this.logger.warn(`Alert address confirmation to ${recipient} failed: ${error instanceof Error ? error.message : error}`);
    });
  }

  async sendTestEmail(userId: string | undefined) {
    if (!userId) {
      throw new UnauthorizedException('Session invalide');
    }
    if (!this.mailService.isConfigured) {
      throw new ServiceUnavailableException("L'envoi d'emails n'est pas configuré (SMTP_HOST ou SMTP_PASSWORD manquant)");
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Utilisateur introuvable');
    }
    const recipient = alertEmailAddress(user);
    if (!recipient) {
      throw new BadRequestException("Aucune adresse email valide n'est associée à ce compte");
    }
    try {
      await this.mailService.send(
        recipient,
        renderNotificationAddress({
          kind: 'test',
          recipient,
          recipientName: user.name,
          source: alertEmailSource(user),
          internalDomain: internalMailDomain(),
          frontendUrl: this.mailService.frontendUrl,
        }),
      );
    } catch (error) {
      this.logger.warn(`Test email to ${recipient} failed: ${error instanceof Error ? error.message : error}`);
      throw new ServiceUnavailableException("Le relais SMTP a refusé l'envoi, réessaie dans un instant");
    }
    return { sentTo: recipient, sentAt: new Date().toISOString() };
  }

  // Grants workspace membership from Authentik group claims on every SSO
  // login. Deliberately additive-only - never removes a membership, even one
  // whose group is absent from this login's claims. An incomplete or
  // misconfigured `groups` claim (missing scope, a not-yet-provisioned
  // group, a bad Authentik property-mapping expression) is easy to hit in
  // practice, and the failure mode must be "doesn't grant a new workspace
  // this time", never "silently revokes a workspace the user already had".
  // Revocation is an explicit platform-admin action (see
  // WorkspacesService.removeMember) instead. `source: 'sso'` tags rows this
  // method creates so a future opt-in full add+revoke sync mode can be
  // scoped to only ever touch what it itself granted, never a manually
  // ('manual') added membership.
  async syncWorkspaceMembershipsFromSso(userId: string, groupClaims: string[]): Promise<void> {
    if (groupClaims.length === 0) return;

    const matchingWorkspaces = await this.prisma.workspace.findMany({
      where: { ssoGroupClaim: { in: groupClaims } },
      select: { id: true },
    });
    if (matchingWorkspaces.length === 0) return;

    await Promise.all(
      matchingWorkspaces.map((workspace) =>
        this.prisma.workspaceMembership.upsert({
          where: { workspaceId_userId: { workspaceId: workspace.id, userId } },
          create: { workspaceId: workspace.id, userId, source: 'sso' },
          update: {},
        }),
      ),
    );
  }

  // Turns invitations sent to this address (before the account existed, see
  // WorkspacesService.inviteByEmail) into memberships, with the role chosen
  // at invitation time. Expired ones are simply dropped.
  async acceptPendingInvitations(user: User): Promise<void> {
    const invitations = await this.prisma.workspaceInvitation.findMany({
      where: { email: user.email.toLowerCase() },
      include: { customRole: { select: { permissions: true } } },
    });
    if (invitations.length === 0) return;

    const now = new Date();
    for (const invitation of invitations) {
      if (invitation.expiresAt > now) {
        const existing = await this.prisma.workspaceMembership.findUnique({
          where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: user.id } },
        });
        if (!existing) {
          await this.prisma.workspaceMembership.create({
            data: {
              workspaceId: invitation.workspaceId,
              userId: user.id,
              role: invitation.role,
              permissions: invitation.customRole?.permissions ?? invitation.permissions,
              customRoleId: invitation.customRoleId,
              source: 'invitation',
            },
          });
          await this.prisma.auditLog.create({
            data: {
              workspaceId: invitation.workspaceId,
              actorUserId: user.id,
              action: 'workspace.invitation.accept',
              resourceType: 'workspace',
              resourceId: invitation.workspaceId,
              details: { email: user.email, role: invitation.role, invitedById: invitation.invitedById },
            },
          });
          this.logger.log(`Invitation to workspace ${invitation.workspaceId} accepted by ${user.email}`);
        }
      }
      await this.prisma.workspaceInvitation.delete({ where: { id: invitation.id } });
    }
  }

  async getProfile(userId?: string) {
    if (!userId) {
      throw new UnauthorizedException('Session invalide');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        isSuperuser: true,
        canCreateWorkspaces: true,
        internalEmail: true,
        alertEmailsEnabled: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user) {
      throw new UnauthorizedException('Utilisateur introuvable');
    }

    // Platform admins can switch into any workspace; regular members only
    // ever see the ones they belong to (WorkspaceGuard enforces the same
    // set server-side - this list just drives the frontend switcher).
    const workspaces = user.isSuperuser
      ? await this.prisma.workspace.findMany({
          select: { id: true, name: true, slug: true, isDefault: true },
          orderBy: { createdAt: 'asc' },
        })
      : await this.prisma.workspace
          .findMany({
            where: { memberships: { some: { userId } } },
            select: { id: true, name: true, slug: true, isDefault: true },
            orderBy: { createdAt: 'asc' },
          });

    // Null for platform admins (no limit) and for users outside the access
    // group (no creation at all, canCreateWorkspaces says which).
    const workspaceQuota = user.isSuperuser ? null : await workspaceCreationQuota(this.prisma, user.id);

    return { ...user, workspaces, workspaceQuota, alertEmail: this.alertEmailSettings(user) };
  }

  private alertEmailSettings(user: { email: string; internalEmail: string | null }) {
    return {
      address: alertEmailAddress(user),
      source: alertEmailSource(user),
      internalDomain: internalMailDomain(),
      mailConfigured: this.mailService.isConfigured,
    };
  }

  async updateProfile(userId: string | undefined, dto: UpdateProfileDto) {
    if (!userId) {
      throw new UnauthorizedException('Session invalide');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Utilisateur introuvable');
    }

    const nextEmail = dto.email?.trim().toLowerCase();
    const wantsEmailChange = typeof nextEmail === 'string' && nextEmail.length > 0 && nextEmail !== user.email;
    const wantsPasswordChange = typeof dto.newPassword === 'string' && dto.newPassword.length > 0;
    const wantsAlertToggle =
      typeof dto.alertEmailsEnabled === 'boolean' && dto.alertEmailsEnabled !== user.alertEmailsEnabled;

    if (!wantsEmailChange && !wantsPasswordChange && !wantsAlertToggle) {
      throw new BadRequestException('Aucune modification détectée');
    }

    if (wantsPasswordChange) {
      if (!dto.currentPassword) {
        throw new BadRequestException('Le mot de passe actuel est requis');
      }
      const currentPasswordOk = await this.verifyPassword(dto.currentPassword, user);
      if (!currentPasswordOk) {
        throw new UnauthorizedException('Mot de passe actuel invalide');
      }
    }

    const data: { email?: string; passwordHash?: string; alertEmailsEnabled?: boolean } = {};
    if (wantsAlertToggle) {
      data.alertEmailsEnabled = dto.alertEmailsEnabled;
    }
    if (wantsEmailChange && nextEmail) {
      data.email = nextEmail;
    }
    if (wantsPasswordChange && dto.newPassword) {
      data.passwordHash = await bcrypt.hash(dto.newPassword, 10);
    }

    try {
      const updated = await this.prisma.user.update({
        where: { id: user.id },
        data,
        select: {
          id: true,
          email: true,
          name: true,
          avatarUrl: true,
          isSuperuser: true,
          internalEmail: true,
          alertEmailsEnabled: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      return { ...updated, alertEmail: this.alertEmailSettings(updated) };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Cet email est déjà utilisé');
      }
      throw error;
    }
  }

  // Verifies a raw JWT outside of the passport/HTTP flow (used by the
  // live-updates WebSocket, which authenticates off the same cookie but
  // has no Express request/guard pipeline to hook into). Tries every
  // secret in the current rotation window, same as JwtStrategy.
  verifyToken(rawToken: string): { userId: string; email: string; issuedAt?: number } | null {
    for (const secret of getCandidateJwtSecrets(this.configService)) {
      try {
        const payload = jwt.verify(rawToken, secret) as JwtPayload & { iat?: number };
        return { userId: payload.sub, email: payload.email, issuedAt: payload.iat };
      } catch {
        continue;
      }
    }
    return null;
  }

  private shouldBootstrapDefaultAdmin() {
    return this.configService.get<string>('ENABLE_DEFAULT_ADMIN', 'false') === 'true';
  }

  private getDefaultAdminEmail() {
    const email = this.configService.get<string>('ADMIN_EMAIL', 'admin@tarmac.local');
    return email.trim().toLowerCase();
  }

  // Null when missing or too weak to be worth bootstrapping with: the
  // account would be an open door (the old default was "admin123").
  private getDefaultAdminPassword(): string | null {
    const password = this.configService.get<string>('ADMIN_PASSWORD', '') ?? '';
    if (password.length < 12 || password === 'admin123') return null;
    return password;
  }

  private async ensureDefaultAdmin() {
    const email = this.getDefaultAdminEmail();
    const plainPassword = this.getDefaultAdminPassword();
    if (!plainPassword) {
      this.logger.warn('ENABLE_DEFAULT_ADMIN is on but ADMIN_PASSWORD is missing or too weak (12 characters minimum): no bootstrap account created');
      return false;
    }
    // Only ever creates the very first account of an empty install. It used
    // to also reset an existing account's password on every restart.
    const usersCount = await this.prisma.user.count();
    if (usersCount > 0) {
      return false;
    }
    const passwordHash = await bcrypt.hash(plainPassword, 10);

    await this.prisma.user.create({
      data: { email, passwordHash, isSuperuser: true },
    });
    return true;
  }

  private async verifyPassword(plainPassword: string, user: User) {
    if (!user.passwordHash) {
      return false;
    }
    try {
      return await bcrypt.compare(plainPassword, user.passwordHash);
    } catch (error) {
      if (user.passwordHash === plainPassword) {
        const passwordHash = await bcrypt.hash(plainPassword, 10);
        await this.prisma.user.update({
          where: { id: user.id },
          data: { passwordHash },
        });
        this.logger.warn(`Recovered legacy plaintext password hash for user ${user.email}`);
        return true;
      }

      this.logger.warn(
        `Invalid password hash for user ${user.email}: ${error instanceof Error ? error.message : error}`,
      );
      return false;
    }
  }
}
