import * as crypto from 'crypto';

// Clients connect on a dedicated WireGuard interface, separate from the
// node-to-node mesh (tarmacwg0), so their peers never mix with the mesh's
// and the mesh's own config push can't drop them.
export const VPN_INTERFACE = 'tarmacvpn0';
export const VPN_LISTEN_PORT = Number(process.env.VPN_LISTEN_PORT ?? 51821);
// Inner MTU handed to clients: mesh MTU (1420) minus the IPIP header (20)
// used to relay traffic to a remote exit, with margin for PPPoE clients.
export const VPN_CLIENT_MTU = 1380;
export const VPN_DEFAULT_DNS = ['1.1.1.1', '1.0.0.1'];

// Each entry node gets its own /24 for clients, carved out of the workspace
// mesh /16 well above the node range (nodes all live in x.y.0.0/24, see
// VlanService.generateDeterministicVlanIp): 10.y.(100+n).0/24, n = 1..150.
const CLIENT_SUBNET_BASE_OCTET = 100;
export const MAX_ENTRY_SUBNETS = 150;
const FIRST_CLIENT_HOST = 2;
const LAST_CLIENT_HOST = 254;

// Routing tables used on entry nodes for "leave through exit X" - kept in a
// range the agent owns entirely (it flushes stale tables inside it).
const TABLE_BASE = 21000;
const TABLE_SPAN = 8000;

function meshPrefix(meshCidr: string): string {
  const [address] = meshCidr.split('/');
  const octets = address.split('.');
  if (octets.length !== 4) throw new Error(`Invalid mesh CIDR: ${meshCidr}`);
  return `${octets[0]}.${octets[1]}`;
}

export function inMesh(meshCidr: string, ip: string): boolean {
  return ip.startsWith(`${meshPrefix(meshCidr)}.`);
}

export function clientSubnet(meshCidr: string, subnetIndex: number): string {
  return `${meshPrefix(meshCidr)}.${CLIENT_SUBNET_BASE_OCTET + subnetIndex}.0/24`;
}

export function entryGatewayCidr(meshCidr: string, subnetIndex: number): string {
  return `${meshPrefix(meshCidr)}.${CLIENT_SUBNET_BASE_OCTET + subnetIndex}.1/24`;
}

// The two halves of the workspace /16, as CIDRs an iptables rule can match
// without the iprange module: everything below the client range (fleet
// nodes, x.y.0.0 - x.y.99.255) and the client range itself (x.y.100.0 -
// x.y.255.255, every entry node's /24).
export function meshNodeRangeCidrs(meshCidr: string): string[] {
  const prefix = meshPrefix(meshCidr);
  return [`${prefix}.0.0/18`, `${prefix}.64.0/19`, `${prefix}.96.0/22`];
}

export function clientRangeCidrs(meshCidr: string): string[] {
  const prefix = meshPrefix(meshCidr);
  return [`${prefix}.100.0/22`, `${prefix}.104.0/21`, `${prefix}.112.0/20`, `${prefix}.128.0/17`];
}

export function pickFreeClientIp(meshCidr: string, subnetIndex: number, used: Iterable<string>): string | null {
  const taken = new Set(used);
  const base = `${meshPrefix(meshCidr)}.${CLIENT_SUBNET_BASE_OCTET + subnetIndex}`;
  for (let host = FIRST_CLIENT_HOST; host <= LAST_CLIENT_HOST; host++) {
    const candidate = `${base}.${host}`;
    if (!taken.has(candidate)) return candidate;
  }
  return null;
}

function shortHash(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 8);
}

// One IPIP tunnel per pair of nodes, named after the node on the other end
// so both directions (A exits via B, B exits via A) share it - the kernel
// only allows one ipip tunnel per local/remote pair anyway. 12 chars, well
// under IFNAMSIZ (15).
export function tunnelName(peerNodeId: string): string {
  return `tvpn${shortHash(peerNodeId)}`;
}

// Stable table id per (node, exit peer): hash-based so adding an exit rarely
// renumbers existing ones, with linear probing to stay collision-free
// within the node.
export function assignRoutingTables(peerNodeIds: string[]): Map<string, number> {
  const tables = new Map<string, number>();
  const used = new Set<number>();
  for (const peerId of [...peerNodeIds].sort()) {
    let slot = Number.parseInt(shortHash(peerId), 16) % TABLE_SPAN;
    while (used.has(slot)) slot = (slot + 1) % TABLE_SPAN;
    used.add(slot);
    tables.set(peerId, TABLE_BASE + slot);
  }
  return tables;
}
