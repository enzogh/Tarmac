/**
 * Keys naming the condition an alert is about (Alert.fingerprint).
 *
 * Two jobs: while a key has an unresolved alert, raising it again is a
 * no-op (a node down for an hour is one alert, not one per check), and
 * AlertSupervisorService reads the key back to check whether the
 * condition still holds, closing the alert once it doesn't.
 */
export const alertKey = {
  nodeOffline: (nodeId: string) => `node-offline:${nodeId}`,
  // Several nodes of a workspace that went down together (one alert).
  nodesOffline: (workspaceId: string, nodeIds: string[]) => `nodes-offline:${workspaceId}:${[...nodeIds].sort().join(',')}`,
  // One key per pair and VLAN, whichever side noticed first.
  vlanLink: (vlanId: string, nodeA: string, nodeB: string) => `vlan-link:${vlanId}:${[nodeA, nodeB].sort().join(':')}`,
  gatewayFailover: (vlanId: string, region: string) => `gateway-failover:${vlanId}:${region}`,
  mountStuck: (mountId: string) => `mount-stuck:${mountId}`,
  mountError: (mountId: string) => `mount-error:${mountId}`,
  syncJob: (syncJobId: string) => `sync-job:${syncJobId}`,
  // The level is part of the key: a disk going from degraded to failing is
  // news, not a repeat.
  smart: (nodeId: string, level: string, diskName: string) => `smart:${nodeId}:${level}:${diskName}`,
  rule: (ruleId: string, nodeId: string) => `rule:${ruleId}:${nodeId}`,
  dnsPortGroup: (nodeId: string) => `dns-port-group:${nodeId}`,
  dnsPortForwarder: (nodeId: string) => `dns-port-forwarder:${nodeId}`,
  dnsSync: (zoneId: string, nodeId: string) => `dns-sync:${zoneId}:${nodeId}`,
  dnsMaintenance: (nodeId: string, task: string) => `dns-maintenance:${nodeId}:${task}`,
  // Platform-level, closed by the loop that raised them on its next success.
  reconciliation: () => 'system:reconciliation',
  heartbeatMonitor: () => 'system:heartbeat-monitor',
};

/** Nodes whose outage an unresolved alert with this key already reports. */
export function nodesCoveredBy(key: string): string[] {
  const { kind, parts } = parseAlertKey(key);
  if (kind === 'node-offline') return parts.slice(0, 1);
  if (kind === 'nodes-offline') return (parts[1] ?? '').split(',').filter(Boolean);
  return [];
}

export type ParsedAlertKey = { kind: string; parts: string[] };

export function parseAlertKey(key: string): ParsedAlertKey {
  const [kind, ...parts] = key.split(':');
  return { kind, parts };
}
