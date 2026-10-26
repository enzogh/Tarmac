import type { VlanConnection, VlanMember } from './api';

export type LinkHealth = { total: number; healthy: number; degraded: number; offline: number };

const RANK: Record<VlanConnection['status'], number> = { healthy: 0, unknown: 1, degraded: 2, offline: 3 };

/**
 * Health of the private network counted per real link: both directions of a
 * pair folded into one (worst wins), and cross-region pairs that only talk
 * through the regional gateways left out - they have no direct WireGuard
 * peer, so their "offline" rows say nothing. Same rule as the Réseau privé
 * page (and AgentsService.reconcileOverlayForVlan on the API side).
 */
export function summarizeLinks(members: VlanMember[], connections: VlanConnection[]): LinkHealth {
  const region = new Map(members.map((member) => [member.nodeId, member.region ?? null]));
  const gatewayByRegion = new Map<string, string>();
  for (const member of members) {
    if (member.region && member.node?.overlayIsGateway) gatewayByRegion.set(member.region, member.nodeId);
  }
  const physical = (a: string, b: string) => {
    const regionA = region.get(a) ?? null;
    const regionB = region.get(b) ?? null;
    if (!regionA || !regionB || regionA === regionB) return true;
    const gatewayA = gatewayByRegion.get(regionA);
    const gatewayB = gatewayByRegion.get(regionB);
    if (!gatewayA || !gatewayB) return true;
    return (a === gatewayA && b === gatewayB) || (a === gatewayB && b === gatewayA);
  };
  const worst = new Map<string, VlanConnection['status']>();
  for (const connection of connections) {
    if (!physical(connection.sourceNodeId, connection.targetNodeId)) continue;
    const key = [connection.sourceNodeId, connection.targetNodeId].sort().join('__');
    const previous = worst.get(key);
    if (!previous || RANK[connection.status] > RANK[previous]) worst.set(key, connection.status);
  }
  const statuses = [...worst.values()];
  return {
    total: statuses.length,
    healthy: statuses.filter((status) => status === 'healthy').length,
    degraded: statuses.filter((status) => status === 'degraded').length,
    offline: statuses.filter((status) => status === 'offline').length,
  };
}
