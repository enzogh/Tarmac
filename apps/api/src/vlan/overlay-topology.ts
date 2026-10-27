import { Region } from './region';

export type OverlayMember = {
  nodeId: string;
  region: Region | null;
  vlanIp: string | null;
  overlayPublicKey: string | null;
  overlayEndpoint: string | null;
};

export type OverlayPeer = {
  nodeId: string;
  publicKey: string;
  endpoint: string;
  allowedIps: string[];
  persistentKeepalive: number;
};

export type OverlayPlan = { nodeId: string; peers: OverlayPeer[]; ipForward: boolean };

/**
 * WireGuard peers for every member of a VLAN, given the gateway currently
 * carrying each region (see activeGateways).
 *
 * Members in the same region (or where region can't be resolved on either
 * side) stay fully meshed - direct /32 peers. A cross-region pair is only
 * routed through gateways when BOTH regions have an active gateway:
 * gateways hold a single peer to each remote gateway carrying that whole
 * region's hosts, other members reach remote regions through their local
 * gateway's peer. Without any gateway, every pair is a direct peer.
 */
export function planOverlayPeers(members: OverlayMember[], gatewayByRegion: Map<Region, string>): OverlayPlan[] {
  const plans: OverlayPlan[] = [];
  for (const member of members) {
    if (!member.vlanIp || !member.overlayPublicKey) continue;

    const region = member.region;
    const localGatewayId = region ? gatewayByRegion.get(region) : undefined;
    const isGateway = localGatewayId === member.nodeId;
    const peers: OverlayPeer[] = [];
    const peerByNodeId = new Map<string, OverlayPeer>();
    const regionIps = (target: Region) =>
      members.filter((m) => m.region === target && m.vlanIp).map((m) => `${m.vlanIp}/32`);

    for (const candidate of members) {
      if (candidate.nodeId === member.nodeId || !candidate.vlanIp || !candidate.overlayPublicKey || !candidate.overlayEndpoint) {
        continue;
      }
      const candidateRegion = candidate.region;
      const sameRegion = !region || !candidateRegion || region === candidateRegion;
      const remoteGatewayId = sameRegion ? undefined : gatewayByRegion.get(candidateRegion as Region);
      const segmented = !sameRegion && Boolean(localGatewayId) && Boolean(remoteGatewayId);
      const peerFor = (allowedIps: string[]): OverlayPeer => ({
        nodeId: candidate.nodeId,
        publicKey: candidate.overlayPublicKey as string,
        endpoint: candidate.overlayEndpoint as string,
        allowedIps,
        persistentKeepalive: 25,
      });

      if (!segmented) {
        const peer = peerFor([`${candidate.vlanIp}/32`]);
        peers.push(peer);
        peerByNodeId.set(candidate.nodeId, peer);
        continue;
      }
      // Individual remote members are reached through the remote gateway,
      // never directly; a non-gateway has no peer into the other region.
      if (isGateway && candidate.nodeId === remoteGatewayId) {
        const peer = peerFor(regionIps(candidateRegion as Region));
        peers.push(peer);
        peerByNodeId.set(candidate.nodeId, peer);
      }
    }

    if (!isGateway && localGatewayId) {
      const localGatewayPeer = peerByNodeId.get(localGatewayId);
      if (localGatewayPeer) {
        for (const otherRegion of gatewayByRegion.keys()) {
          if (otherRegion === region) continue;
          localGatewayPeer.allowedIps.push(...regionIps(otherRegion));
        }
      }
    }

    plans.push({ nodeId: member.nodeId, peers, ipForward: isGateway });
  }
  return plans;
}

export type GatewayCandidate = {
  nodeId: string;
  region: Region | null;
  isPrimary: boolean;
  isBackup: boolean;
};

/**
 * The gateway carrying each region: its designated primary, unless the
 * failover watcher currently routes that region through its backup.
 */
export function activeGateways(candidates: GatewayCandidate[], failedOver: ReadonlySet<Region>): Map<Region, string> {
  const active = new Map<Region, string>();
  for (const candidate of candidates) {
    if (!candidate.region || !candidate.isPrimary) continue;
    active.set(candidate.region, candidate.nodeId);
  }
  for (const candidate of candidates) {
    if (!candidate.region || !candidate.isBackup || !failedOver.has(candidate.region)) continue;
    active.set(candidate.region, candidate.nodeId);
  }
  return active;
}

// The primary must have stayed back online this long before the region is
// handed back to it, so a flapping primary doesn't reshuffle the mesh.
export const GATEWAY_FAILBACK_STABLE_MS = 2 * 60_000;

/**
 * Failover decision for one region. Switches to the backup only when the
 * primary is down and the backup up; hands back once the primary has been
 * up for GATEWAY_FAILBACK_STABLE_MS, or right away if the backup itself
 * goes down while the primary is up.
 */
export function shouldUseBackup(
  usingBackup: boolean,
  primaryUp: boolean,
  backupUp: boolean,
  primaryUpForMs: number,
): boolean {
  if (!usingBackup) return !primaryUp && backupUp;
  if (!primaryUp) return true;
  if (!backupUp) return false;
  return primaryUpForMs < GATEWAY_FAILBACK_STABLE_MS;
}
