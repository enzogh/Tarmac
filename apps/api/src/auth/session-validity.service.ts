import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

type SessionState = { disabled: boolean; revokedAfter: number | null; hasAccess: boolean } | null;

// Whether a signed session is still honoured: the account exists, isn't
// disabled, still has access (Authentik access group, or platform admin),
// the token was issued after the last revocation, and it wasn't ended by a
// logout. Checked on every authenticated request, so answers are cached
// briefly; anything that revokes calls forget()/revoke() to make it
// effective at once in this process.
@Injectable()
export class SessionValidityService {
  private static readonly TTL_MS = 10_000;
  private readonly logger = new Logger(SessionValidityService.name);
  private readonly cache = new Map<string, { at: number; state: SessionState }>();
  private readonly revokedCache = new Map<string, { at: number; revoked: boolean }>();

  constructor(private readonly prisma: PrismaService) {}

  async check(userId: string, issuedAtSeconds?: number, jti?: string): Promise<'ok' | 'unknown' | 'disabled' | 'revoked'> {
    if (!userId) return 'unknown';
    const state = await this.load(userId);
    if (!state) return 'unknown';
    if (state.disabled) return 'disabled';
    if (!state.hasAccess) return 'revoked';
    // Tokens carry second precision: a session issued in the same second as
    // the revocation is treated as revoked.
    if (state.revokedAfter !== null && (issuedAtSeconds ?? 0) * 1000 <= state.revokedAfter) return 'revoked';
    if (jti && (await this.isLoggedOut(jti))) return 'revoked';
    return 'ok';
  }

  forget(userId: string) {
    this.cache.delete(userId);
  }

  // Ends one session (logout) without touching the user's other devices.
  async revoke(jti: string, userId: string, expiresAt: Date): Promise<void> {
    await this.prisma.revokedSession.upsert({
      where: { jti },
      create: { jti, userId, expiresAt },
      update: {},
    });
    this.revokedCache.set(jti, { at: Date.now(), revoked: true });
  }

  private async isLoggedOut(jti: string): Promise<boolean> {
    const cached = this.revokedCache.get(jti);
    // A revoked session never comes back: no need to look it up again.
    if (cached && (cached.revoked || Date.now() - cached.at < SessionValidityService.TTL_MS)) return cached.revoked;
    const row = await this.prisma.revokedSession.findUnique({ where: { jti }, select: { jti: true } });
    this.revokedCache.set(jti, { at: Date.now(), revoked: !!row });
    return !!row;
  }

  private async load(userId: string): Promise<SessionState> {
    const cached = this.cache.get(userId);
    if (cached && Date.now() - cached.at < SessionValidityService.TTL_MS) return cached.state;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { disabledAt: true, sessionsRevokedAt: true, isSuperuser: true, canCreateWorkspaces: true, ssoSubject: true },
    });
    // Accounts that never went through SSO (the bootstrap admin) have no
    // access group to lose; only superusers can password-login anyway.
    const state: SessionState = user
      ? {
          disabled: user.disabledAt !== null,
          revokedAfter: user.sessionsRevokedAt?.getTime() ?? null,
          hasAccess: user.isSuperuser || user.canCreateWorkspaces || !user.ssoSubject,
        }
      : null;
    this.cache.set(userId, { at: Date.now(), state });
    return state;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async sweepExpired() {
    try {
      await this.prisma.revokedSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      const cutoff = Date.now() - 60_000;
      for (const [jti, entry] of this.revokedCache) if (entry.at < cutoff) this.revokedCache.delete(jti);
      for (const [userId, entry] of this.cache) if (entry.at < cutoff) this.cache.delete(userId);
    } catch (error) {
      this.logger.warn(`Revoked-session sweep failed: ${error instanceof Error ? error.message : error}`);
    }
  }
}
