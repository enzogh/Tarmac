import * as crypto from 'crypto';

// The areas a key can be granted, each as `<resource>:read` and/or
// `<resource>:write` (write implies read, see ApiKeyOrJwtGuard). A key only
// ever reaches controllers tagged with @ApiKeyResource or handlers declaring
// @RequireApiScope - everything else (accounts, workspaces, members, the keys
// themselves) stays session-only, so a key can never widen its own access.
export const API_KEY_RESOURCES = ['nodes', 'storage', 'network', 'dns', 'vpn', 'alerts', 'logs'] as const;
export type ApiKeyResource = (typeof API_KEY_RESOURCES)[number];
// Journals are history: there is nothing to write.
const READ_ONLY_RESOURCES: ReadonlySet<ApiKeyResource> = new Set(['logs']);

export const API_KEY_SCOPES = API_KEY_RESOURCES.flatMap((resource) =>
  READ_ONLY_RESOURCES.has(resource) ? [`${resource}:read`] : [`${resource}:read`, `${resource}:write`],
) as ApiKeyScope[];
export type ApiKeyScope = `${ApiKeyResource}:${'read' | 'write'}`;

/** Whether `granted` satisfies `required` - write access includes read. */
export function scopeGrants(granted: readonly string[], required: ApiKeyScope): boolean {
  if (granted.includes(required)) return true;
  const [resource, access] = required.split(':');
  return access === 'read' && granted.includes(`${resource}:write`);
}

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

/** Drops unknown scopes and adds the read each write implies, in a stable order. */
export function normalizeScopes(scopes: readonly string[]): ApiKeyScope[] {
  const granted = new Set(scopes);
  return API_KEY_SCOPES.filter((scope) => granted.has(scope) || (scope.endsWith(':read') && granted.has(scope.replace(':read', ':write'))));
}
