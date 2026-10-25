import * as crypto from 'crypto';

// WireGuard keys are raw 32-byte Curve25519 values, base64-encoded. Node's
// KeyObject only exports them wrapped in DER (PKCS#8 / SPKI), whose last 32
// bytes are the raw key - same bytes `wg genkey` / `wg pubkey` produce.
export function generateWireguardKeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
  const rawPrivate = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
  const rawPublic = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  return { privateKey: rawPrivate.toString('base64'), publicKey: rawPublic.toString('base64') };
}

export function generateWireguardPresharedKey(): string {
  return crypto.randomBytes(32).toString('base64');
}

export function isWireguardKey(value: string): boolean {
  return /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw480]=$/.test(value);
}
