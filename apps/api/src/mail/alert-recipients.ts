import type { PrismaClient } from '@prisma/client';

export const DEFAULT_INTERNAL_MAIL_DOMAIN = 'intraced.fr';

export function internalMailDomain(): string {
  return (process.env.ALERT_EMAIL_INTERNAL_DOMAIN || DEFAULT_INTERNAL_MAIL_DOMAIN).trim().toLowerCase().replace(/^@/, '');
}

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Finds an address on the internal mail domain anywhere in a set of OIDC
// claims. Authentik exposes extra addresses through whatever property
// mapping the admin wrote (a custom claim, user attributes, an alias list),
// so rather than hardcode one claim name this walks every string in the
// claims and takes the first match - `email` itself is checked first so an
// account whose primary address is already internal always wins.
export function findInternalEmail(claims: Record<string, unknown>, domain = internalMailDomain()): string | null {
  const suffix = `@${domain}`;

  // The intranet's own Authentik attributes, exposed by the "tarmac" scope
  // mapping: has_intranet_mail is the authority - false means the mailbox
  // was removed even if a stale intranet_mail value is still set. The value
  // may be a bare local part, so the domain is added when missing.
  if (claims.has_intranet_mail === false) return null;
  const intranetMail = typeof claims.intranet_mail === 'string' ? claims.intranet_mail.trim().toLowerCase() : '';
  if (intranetMail) {
    return intranetMail.includes('@') ? intranetMail : `${intranetMail}${suffix}`;
  }

  const seen = new Set<unknown>();
  const queue: unknown[] = [claims.email, claims];
  while (queue.length > 0) {
    const value = queue.shift();
    if (value === null || value === undefined || seen.has(value)) continue;
    seen.add(value);
    if (typeof value === 'string') {
      const match = value.match(EMAIL_PATTERN)?.find((candidate) => candidate.toLowerCase().endsWith(suffix));
      if (match) return match.toLowerCase();
    } else if (Array.isArray(value)) {
      queue.push(...value);
    } else if (typeof value === 'object') {
      queue.push(...Object.values(value as Record<string, unknown>));
    }
  }
  return null;
}

// Where a user's alert emails go: the internal address when the last SSO
// login found one, otherwise the address the account was created with.
// Placeholder addresses like the seeded admin@tarmac.local can't receive
// mail, so they resolve to null instead of bouncing at the relay.
export function alertEmailAddress(user: { email: string; internalEmail: string | null }): string | null {
  const address = (user.internalEmail || user.email).trim().toLowerCase();
  if (!address.includes('@') || address.endsWith('.local')) return null;
  return address;
}

export function alertEmailSource(user: { internalEmail: string | null }): 'internal' | 'account' {
  return user.internalEmail ? 'internal' : 'account';
}

// Email notification channels store their target as free text; accept one
// or several addresses separated by commas, semicolons or whitespace.
export function parseChannelTargets(target: string): string[] {
  return target
    .split(/[\s,;]+/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(part));
}

/**
 * Everyone a workspace's alert emails go to: members who can see the
 * Alertes page and haven't turned the emails off, plus its email channels.
 */
export async function workspaceAlertRecipients(
  prisma: Pick<PrismaClient, 'workspaceMembership' | 'notificationChannel'>,
  workspaceId: string,
): Promise<string[]> {
  const [memberships, channels] = await Promise.all([
    prisma.workspaceMembership.findMany({
      // Members whose role hides the Alertes page don't get its emails either.
      where: {
        workspaceId,
        user: { alertEmailsEnabled: true },
        OR: [{ role: 'owner' }, { permissions: { hasSome: ['alerts:read', 'alerts:write'] } }],
      },
      select: { user: { select: { email: true, internalEmail: true } } },
    }),
    prisma.notificationChannel.findMany({
      where: { workspaceId, type: 'email', enabled: true },
      select: { target: true },
    }),
  ]);

  const addresses = new Set<string>();
  for (const { user } of memberships) {
    const address = alertEmailAddress(user);
    if (address) addresses.add(address);
  }
  for (const channel of channels) {
    for (const address of parseChannelTargets(channel.target)) addresses.add(address);
  }
  return [...addresses];
}
