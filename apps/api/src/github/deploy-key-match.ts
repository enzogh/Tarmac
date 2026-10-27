import { createHash } from 'crypto';

// "<type> <base64>" without the comment: how GitHub returns a deploy key,
// and what two copies of the same key always share. null for anything that
// isn't an SSH public key.
export function normalizePublicKey(raw: string | null | undefined): string | null {
  const parts = (raw ?? '').trim().split(/\s+/);
  if (parts.length < 2) return null;
  const [type, body] = parts;
  if (!/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com)$/.test(type)) return null;
  if (!/^[A-Za-z0-9+/]+={0,3}$/.test(body) || body.length > 2000) return null;
  // A real key's blob opens with its own type, length-prefixed.
  const blob = Buffer.from(body, 'base64');
  if (blob.length < 4 || blob.toString('latin1', 4, 4 + blob.readUInt32BE(0)) !== type) return null;
  return `${type} ${body}`;
}

// Same form as `ssh-keygen -l` and GitHub's UI: "SHA256:<base64, no padding>".
export function publicKeyFingerprint(key: string): string {
  const body = key.split(' ')[1] ?? '';
  return `SHA256:${createHash('sha256').update(Buffer.from(body, 'base64')).digest('base64').replace(/=+$/, '')}`;
}

export type GithubDeployKey = { id: number; key: string; title: string; read_only: boolean; created_at?: string };

export type NodeKeyRef = { id: string; deployKeyPublic: string | null; githubDeployKeyId: string | null };

export type DeployKeyMatch = {
  // Node id -> GitHub key id, for nodes whose key is on GitHub.
  linked: Map<string, string>;
  // Nodes that reported a key GitHub doesn't have.
  missing: string[];
  // GitHub keys no node reported.
  orphans: GithubDeployKey[];
};

export function matchDeployKeys(nodes: NodeKeyRef[], keys: GithubDeployKey[]): DeployKeyMatch {
  const byMaterial = new Map<string, GithubDeployKey>();
  for (const key of keys) {
    const normalized = normalizePublicKey(key.key);
    if (normalized) byMaterial.set(normalized, key);
  }
  const linked = new Map<string, string>();
  const missing: string[] = [];
  const used = new Set<number>();
  for (const node of nodes) {
    const normalized = normalizePublicKey(node.deployKeyPublic);
    if (!normalized) continue;
    const key = byMaterial.get(normalized);
    if (key) {
      linked.set(node.id, String(key.id));
      used.add(key.id);
    } else {
      missing.push(node.id);
    }
  }
  return { linked, missing, orphans: keys.filter((key) => !used.has(key.id)) };
}
