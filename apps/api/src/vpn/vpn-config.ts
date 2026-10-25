import { VPN_CLIENT_MTU } from './vpn-network';

export type VpnClientConfigInput = {
  profileName: string;
  workspaceName: string;
  entryNodeName: string;
  mode: 'full' | 'private';
  clientIp: string;
  clientPrivateKey: string | null;
  presharedKey: string;
  dns: string[];
  serverPublicKey: string;
  endpoint: string;
  meshCidr: string;
};

// Standard wg-quick format, importable as-is by every official WireGuard
// client (Windows/macOS/Linux/iOS/Android).
export function renderClientConfig(input: VpnClientConfigInput): string {
  // ::/0 in full mode is deliberate: with no IPv6 path through the fleet,
  // capturing it is what stops IPv6 traffic leaking outside the tunnel.
  const allowedIps = input.mode === 'full' ? '0.0.0.0/0, ::/0' : input.meshCidr;
  const lines = [
    `# Tarmac — ${input.profileName}`,
    `# Workspace : ${input.workspaceName} · point d'entrée : ${input.entryNodeName}`,
    '[Interface]',
    `PrivateKey = ${input.clientPrivateKey ?? '<VOTRE_CLE_PRIVEE>'}`,
    `Address = ${input.clientIp}/32`,
  ];
  if (input.dns.length > 0) lines.push(`DNS = ${input.dns.join(', ')}`);
  lines.push(
    `MTU = ${VPN_CLIENT_MTU}`,
    '',
    '[Peer]',
    `PublicKey = ${input.serverPublicKey}`,
    `PresharedKey = ${input.presharedKey}`,
    `Endpoint = ${input.endpoint}`,
    `AllowedIPs = ${allowedIps}`,
    'PersistentKeepalive = 25',
    '',
  );
  return lines.join('\n');
}

export function configFilename(profileName: string): string {
  // Some clients (Windows, Android) reject tunnel names over 15 chars or
  // with anything outside [a-zA-Z0-9_=+.-].
  const base = profileName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_=+.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 15);
  return `${base || 'tarmac'}.conf`;
}
