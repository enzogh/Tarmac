import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SessionValidityService } from './session-validity.service';

export const ACCESS_SYNC_SETTING = 'authentikAccessSync';

export interface AccessSyncStatus {
  configured: boolean;
  lastRunAt: string | null;
  ok: boolean | null;
  message: string | null;
  checked: number;
  revoked: string[];
  restored: string[];
}

interface AuthentikMember {
  pk: number;
  uid?: string;
  username?: string;
  email?: string;
  is_active?: boolean;
}

// The access group is only read from the ID token at sign-in, so someone
// removed from it in Authentik used to keep their open session for up to
// 12 h. Every few minutes this asks the Authentik API who is still in the
// group (and still active), and revokes the sessions of everyone else -
// SessionValidityService then refuses their token on the next request.
//
// Needs AUTHENTIK_API_TOKEN (a read-only service account token). Without
// it, or when Authentik can't be reached or the group is missing, nothing is
// changed: a transient failure must never lock everybody out.
@Injectable()
export class AuthentikAccessSyncService {
  private readonly logger = new Logger(AuthentikAccessSyncService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly sessionValidity: SessionValidityService,
  ) {}

  get isConfigured(): boolean {
    return Boolean(this.configService.get<string>('AUTHENTIK_API_TOKEN') && this.apiBase());
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async scheduled() {
    if (!this.isConfigured || this.running) return;
    await this.run();
  }

  async status(): Promise<AccessSyncStatus> {
    const setting = await this.prisma.platformSetting.findUnique({ where: { key: ACCESS_SYNC_SETTING } });
    const stored = (setting?.value ?? {}) as Partial<AccessSyncStatus>;
    return {
      configured: this.isConfigured,
      lastRunAt: stored.lastRunAt ?? null,
      ok: stored.ok ?? null,
      message: stored.message ?? null,
      checked: stored.checked ?? 0,
      revoked: stored.revoked ?? [],
      restored: stored.restored ?? [],
    };
  }

  async run(): Promise<AccessSyncStatus> {
    if (!this.isConfigured) return this.status();
    this.running = true;
    try {
      const members = await this.fetchGroupMembers();
      const result = await this.apply(members);
      return await this.save({ ok: true, message: null, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Authentik access sync skipped: ${message}`);
      return await this.save({ ok: false, message, checked: 0, revoked: [], restored: [] });
    } finally {
      this.running = false;
    }
  }

  private async apply(members: AuthentikMember[]) {
    const active = members.filter((member) => member.is_active !== false);
    const identities = new Set<string>();
    for (const member of active) {
      for (const value of [member.uid, member.username, member.email, String(member.pk)]) {
        if (value) identities.add(value.toLowerCase());
      }
    }
    const inGroup = (user: { email: string; ssoSubject: string | null }) =>
      identities.has(user.email.toLowerCase()) || (user.ssoSubject ? identities.has(user.ssoSubject.toLowerCase()) : false);

    // Platform admins come from Authentik's superuser flag, not the group:
    // they are left alone here.
    const users = await this.prisma.user.findMany({
      where: { isSuperuser: false, ssoSubject: { not: null } },
      select: { id: true, email: true, ssoSubject: true, canCreateWorkspaces: true },
    });

    const now = new Date();
    const revoked: string[] = [];
    const restored: string[] = [];
    for (const user of users) {
      const member = inGroup(user);
      if (user.canCreateWorkspaces && !member) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { canCreateWorkspaces: false, sessionsRevokedAt: now, accessCheckedAt: now },
        });
        this.sessionValidity.forget(user.id);
        revoked.push(user.email);
        this.logger.warn(`Access revoked for ${user.email}: no longer an active member of "${this.accessGroup()}" in Authentik`);
        await this.prisma.auditLog.create({
          data: { actorUserId: null, action: 'admin.user.access-revoked', resourceType: 'user', resourceId: user.id, details: { email: user.email, group: this.accessGroup() } },
        });
      } else if (!user.canCreateWorkspaces && member) {
        // Back in the group: they may sign in again (their old sessions stay revoked).
        await this.prisma.user.update({ where: { id: user.id }, data: { canCreateWorkspaces: true, accessCheckedAt: now } });
        this.sessionValidity.forget(user.id);
        restored.push(user.email);
      } else {
        await this.prisma.user.update({ where: { id: user.id }, data: { accessCheckedAt: now } });
      }
    }
    return { checked: users.length, revoked, restored };
  }

  private async fetchGroupMembers(): Promise<AuthentikMember[]> {
    const group = this.accessGroup();
    const url = `${this.apiBase()}/core/groups/?name=${encodeURIComponent(group)}&include_users=true`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.configService.get<string>('AUTHENTIK_API_TOKEN')}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(response.status === 401 || response.status === 403 ? `jeton refusé par Authentik (HTTP ${response.status})` : `Authentik a répondu HTTP ${response.status}`);
    }
    const body = (await response.json()) as { results?: { name: string; users_obj?: AuthentikMember[] }[] };
    const match = body.results?.find((result) => result.name === group);
    if (!match) throw new Error(`groupe « ${group} » introuvable dans Authentik`);
    if (!Array.isArray(match.users_obj)) throw new Error('Authentik ne renvoie pas les membres du groupe (droits du jeton ?)');
    return match.users_obj;
  }

  private async save(result: Omit<AccessSyncStatus, 'configured' | 'lastRunAt'>): Promise<AccessSyncStatus> {
    const value = { ...result, lastRunAt: new Date().toISOString() };
    await this.prisma.platformSetting.upsert({
      where: { key: ACCESS_SYNC_SETTING },
      create: { key: ACCESS_SYNC_SETTING, value: value as Prisma.InputJsonObject },
      update: { value: value as Prisma.InputJsonObject },
    });
    return { configured: this.isConfigured, ...value };
  }

  private accessGroup() {
    return this.configService.get<string>('AUTHENTIK_ACCESS_GROUP', 'tarmac');
  }

  // AUTHENTIK_API_URL, else the issuer's origin + /api/v3.
  private apiBase(): string | null {
    const explicit = this.configService.get<string>('AUTHENTIK_API_URL');
    if (explicit) return explicit.replace(/\/$/, '');
    const issuer = this.configService.get<string>('AUTHENTIK_ISSUER_URL');
    if (!issuer) return null;
    try {
      return `${new URL(issuer).origin}/api/v3`;
    } catch {
      return null;
    }
  }
}
