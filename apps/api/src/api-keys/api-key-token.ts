import * as crypto from 'crypto';

// Every scope an API key can be granted. A key only ever reaches handlers
// that explicitly declare one of these with @RequireApiScope - anything else
// stays session-only, so adding a scope here is what opens a new surface to
// keys, never the other way round.
export const API_KEY_SCOPES = ['vpn:read', 'vpn:write'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

// tmk_<prefix>_<secret>. The prefix is public (stored in clear, shown in the
// UI so a key can be recognised in logs); only sha256(secret) is stored.
export const API_KEY_TOKEN_PREFIX = 'tmk_';
const TOKEN_PATTERN = /^tmk_([a-z0-9]{10})_([A-Za-z0-9_-]{43})$/;

export function generateApiKeyToken(): { token: string; prefix: string; secretHash: string } {
  const prefix = crypto.randomBytes(8).toString('hex').slice(0, 10);
  const secret = crypto.randomBytes(32).toString('base64url');
  return { token: `${API_KEY_TOKEN_PREFIX}${prefix}_${secret}`, prefix, secretHash: hashApiKeySecret(secret) };
}

export function parseApiKeyToken(token: string): { prefix: string; secret: string } | null {
  const match = TOKEN_PATTERN.exec(token.trim());
  return match ? { prefix: match[1], secret: match[2] } : null;
}

export function hashApiKeySecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

export function apiKeySecretMatches(secret: string, storedHex: string): boolean {
  const candidate = Buffer.from(hashApiKeySecret(secret), 'hex');
  const stored = Buffer.from(storedHex, 'hex');
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}
