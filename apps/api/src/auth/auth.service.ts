import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { User } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service';
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
  ) {}

  async onModuleInit() {
    const shouldBootstrap = this.configService.get<string>('ENABLE_DEFAULT_ADMIN', 'true') !== 'false';

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
  // isSuperuser mirrors the claim honestly - it must NEVER be hardcoded true
  // here. Before Phase 3, every caller of this method had already rejected
  // non-superuser claims upstream, so hardcoding true was a no-op; now that
  // ordinary workspace members can complete this same flow, doing so would
  // silently grant every new SSO-provisioned workspace member full platform-
  // admin rights. Demotion (a previously-true isSuperuser going false) is
  // deliberately NOT applied here even when the claim says false - treat
  // that as a possibly-transient IdP/claim-mapping issue and require a
  // manual platform-admin action to actually revoke platform-admin status.
  async findOrCreateSsoUser(claims: {
    sub: string;
    email: string;
    name?: string | null;
    avatarUrl?: string | null;
    isSuperuser: boolean;
  }): Promise<User> {
    const email = claims.email.trim().toLowerCase();

    const existingBySubject = await this.prisma.user.findUnique({ where: { ssoSubject: claims.sub } });
    if (existingBySubject) {
      return this.prisma.user.update({
        where: { id: existingBySubject.id },
        data: {
          email,
          name: claims.name ?? existingBySubject.name,
          avatarUrl: claims.avatarUrl ?? existingBySubject.avatarUrl,
          isSuperuser: existingBySubject.isSuperuser || claims.isSuperuser,
        },
      });
    }

    const existingByEmail = await this.prisma.user.findUnique({ where: { email } });
    if (existingByEmail) {
      return this.prisma.user.update({
        where: { id: existingByEmail.id },
        data: {
          ssoSubject: claims.sub,
          name: claims.name ?? existingByEmail.name,
          avatarUrl: claims.avatarUrl ?? existingByEmail.avatarUrl,
          isSuperuser: existingByEmail.isSuperuser || claims.isSuperuser,
        },
      });
    }

    return this.prisma.user.create({
      data: {
        email,
        ssoSubject: claims.sub,
        name: claims.name,
        avatarUrl: claims.avatarUrl,
        isSuperuser: claims.isSuperuser,
      },
    });
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

  async hasAnyWorkspaceMembership(userId: string): Promise<boolean> {
    const count = await this.prisma.workspaceMembership.count({ where: { userId } });
    return count > 0;
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

    return { ...user, workspaces };
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

    if (!wantsEmailChange && !wantsPasswordChange) {
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

    const data: { email?: string; passwordHash?: string } = {};
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
          createdAt: true,
          updatedAt: true,
        },
      });
      return updated;
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
  verifyToken(rawToken: string): { userId: string; email: string } | null {
    for (const secret of getCandidateJwtSecrets(this.configService)) {
      try {
        const payload = jwt.verify(rawToken, secret) as JwtPayload;
        return { userId: payload.sub, email: payload.email };
      } catch {
        continue;
      }
    }
    return null;
  }

  private shouldBootstrapDefaultAdmin() {
    return this.configService.get<string>('ENABLE_DEFAULT_ADMIN', 'true') !== 'false';
  }

  private getDefaultAdminEmail() {
    const email = this.configService.get<string>('ADMIN_EMAIL', 'admin@tarmac.local');
    return email.trim().toLowerCase();
  }

  private getDefaultAdminPassword() {
    return this.configService.get<string>('ADMIN_PASSWORD', 'admin123');
  }

  private async ensureDefaultAdmin() {
    const email = this.getDefaultAdminEmail();
    const plainPassword = this.getDefaultAdminPassword();
    const passwordHash = await bcrypt.hash(plainPassword, 10);
    const defaultAdmin = await this.prisma.user.findUnique({ where: { email } });
    if (defaultAdmin) {
      await this.prisma.user.update({
        where: { id: defaultAdmin.id },
        data: { passwordHash, isSuperuser: true },
      });
      return true;
    }

    const usersCount = await this.prisma.user.count();
    if (usersCount > 0) {
      return false;
    }

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
