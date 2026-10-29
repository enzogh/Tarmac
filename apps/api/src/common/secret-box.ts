import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// Encryption at rest for the few secrets the control plane must hand back
// verbatim (VPN client private/preshared keys, DNS group TSIG secrets,
// migration seedbox passwords), so they can't be one-way hashed. The key
// lives outside the database (TARMAC_SECRETS_KEY, base64 of 32 bytes, see
// docker/.env): a dump or an off-site backup of Postgres alone no longer
// exposes them.
//
// Format: enc:v1:<iv>:<tag>:<ciphertext>, all base64. Values without the
// prefix are legacy plaintext and are returned as-is by openSecret(); the
// startup pass in SecretsAtRestService re-encrypts them.

const PREFIX = 'enc:v1:';

let cachedKey: Buffer | null | undefined;

function loadKey(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;
  const raw = process.env.TARMAC_SECRETS_KEY?.trim();
  if (!raw) {
    cachedKey = null;
    return cachedKey;
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('TARMAC_SECRETS_KEY doit être 32 octets encodés en base64 (openssl rand -base64 32)');
  }
  cachedKey = key;
  return cachedKey;
}

export function secretsKeyConfigured(): boolean {
  return loadKey() !== null;
}

export function isSealed(value: string): boolean {
  return value.startsWith(PREFIX);
}

// Without a configured key the value is stored as-is (dev setups); the API
// logs a warning at startup in that case.
export function sealSecret(value: string): string;
export function sealSecret(value: string | null): string | null;
export function sealSecret(value: string | null): string | null {
  if (value === null || isSealed(value)) return value;
  const key = loadKey();
  if (!key) return value;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

export function openSecret(value: string): string;
export function openSecret(value: string | null): string | null;
export function openSecret(value: string | null): string | null {
  if (value === null || !isSealed(value)) return value;
  const key = loadKey();
  if (!key) throw new Error('secret chiffré en base mais TARMAC_SECRETS_KEY absent');
  const [iv, tag, ciphertext] = value.slice(PREFIX.length).split(':');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}
