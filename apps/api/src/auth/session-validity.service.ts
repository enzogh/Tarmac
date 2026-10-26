import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type SessionState = { disabled: boolean; revokedAfter: number | null; hasAccess: boolean } | null;

// Whether a signed session is still honoured: the account exists, isn't
// disabled, still has access (Authentik access group, or platform admin),
// and the token was issued after the last revocation. Checked on every
// authenticated request, so the answer is cached briefly per user; anything
// that revokes calls forget() to make it effective at once in this process.
@Injectable()
export class SessionValidityService {
  private static readonly TTL_MS = 10_000;
  private readonly cache = new Map<string, { at: number; state: SessionState }>();

  constructor(private readonly prisma: PrismaService) {}

  async check(userId: string, issuedAtSeconds?: number): Promise<'ok' | 'unknown' | 'disabled' | 'revoked'> {
    const state = await this.load(userId);
    if (!state) return 'unknown';
    if (state.disabled) return 'disabled';
    if (!state.hasAccess) return 'revoked';
    // Tokens carry second precision: a session issued in the same second as
    // the revocation is treated as revoked.
    if (state.revokedAfter !== null && (issuedAtSeconds ?? 0) * 1000 <= state.revokedAfter) return 'revoked';
    return 'ok';
  }

  forget(userId: string) {
    this.cache.delete(userId);
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
}
