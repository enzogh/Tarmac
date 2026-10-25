'use client';

import { useState } from 'react';
import { api, AgentLogItem, DnsPortConflict } from '@/lib/api';
import { usePolling } from '@/lib/hooks/usePolling';
import { useLiveSocket } from '@/lib/hooks/useLiveSocket';

export type DnsNotice = { type: 'error' | 'success'; message: string } | null;

export type DnsJournalState = {
  expandedLogKey: string | null;
  logsByNode: Record<string, AgentLogItem[]>;
  logsLoadingNodeId: string | null;
  toggleLogs: (key: string, nodeId: string) => Promise<void>;
};

// Owns everything that's genuinely shared across the DNS page's sections:
// polled data, the live-socket handler that patches it in place, the
// top-level notice/busy state, and the Journal panel (shared between group-
// member rows and zone rows - a group's primary member and its zone share
// the same nodeId, so this can't live inside just one section).
export function useDnsPageState() {
  const { data: nodes = [] } = usePolling('nodes', api.nodes.list);
  // Overlay mesh has a single fleet-wide VLAN in practice - reused here only
  // to look up real WireGuard link latency between a group's servers (see
  // GroupsSection's GroupLinkLatency), same data source as the Network page.
  const { data: vlansRaw } = usePolling('vlans', api.vlan.getAll, { intervalMs: 60000 });
  const vlanId = vlansRaw?.vlans[0]?.id ?? null;
  const {
    data: groupsRaw,
    mutate: refreshGroups,
    isLoading: groupsLoading,
  } = usePolling('dns-groups', api.dns.groups.list, { intervalMs: 15000 });
  const {
    data: zonesRaw,
    mutate: refreshZones,
    isLoading: zonesLoading,
  } = usePolling('dns-zones', () => api.dns.zones.list(), { intervalMs: 15000 });
  const groups = groupsRaw ?? [];
  const zones = zonesRaw ?? [];

  const [notice, setNotice] = useState<DnsNotice>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [expandedLogKey, setExpandedLogKey] = useState<string | null>(null);
  const [expandedLogNodeId, setExpandedLogNodeId] = useState<string | null>(null);
  const [logsByNode, setLogsByNode] = useState<Record<string, AgentLogItem[]>>({});
  const [logsLoadingNodeId, setLogsLoadingNodeId] = useState<string | null>(null);

  const toggleLogs = async (key: string, nodeId: string) => {
    if (expandedLogKey === key) {
      setExpandedLogKey(null);
      setExpandedLogNodeId(null);
      return;
    }
    setExpandedLogKey(key);
    setExpandedLogNodeId(nodeId);
    setLogsLoadingNodeId(nodeId);
    try {
      const { items } = await api.agentLogs.list({ nodeId, limit: 100 });
      setLogsByNode((prev) => ({ ...prev, [nodeId]: items.filter((entry) => /dns/i.test(entry.message)) }));
    } catch {
      setLogsByNode((prev) => ({ ...prev, [nodeId]: [] }));
    } finally {
      setLogsLoadingNodeId(null);
    }
  };

  // Patches a group member's / zone's status the instant the agent's
  // command result lands server-side (see agents.service.ts onCommandResult
  // -> live.broadcast('dns.group_member.status'/'dns.zone.status')), instead
  // of waiting for the next 15s poll tick - same pattern as node.heartbeat
  // on the infrastructure page. Bails until the first real poll has landed
  // (groupsRaw/zonesRaw defined) - patching `undefined` would poison the
  // SWR cache permanently (see infrastructure/page.tsx for the same guard).
  useLiveSocket((message) => {
    if (message.type === 'dns.group_member.status') {
      if (!groupsRaw) return;
      const update = message.payload as {
        groupId: string;
        nodeId: string;
        status: 'pending' | 'active' | 'error';
        conflictDetail: DnsPortConflict | null;
      };
      void refreshGroups(
        (current) =>
          current?.map((group) =>
            group.id === update.groupId
              ? {
                  ...group,
                  members: group.members.map((member) =>
                    member.nodeId === update.nodeId
                      ? { ...member, status: update.status, conflictDetail: update.conflictDetail }
                      : member,
                  ),
                }
              : group,
          ) ?? current,
        { revalidate: false },
      );
      return;
    }

    if (message.type === 'dns.zone.status') {
      if (!zonesRaw) return;
      const update = message.payload as { zoneId: string; status: 'pending' | 'active' | 'error' };
      void refreshZones(
        (current) =>
          current?.map((zone) => (zone.id === update.zoneId ? { ...zone, status: update.status } : zone)) ?? current,
        { revalidate: false },
      );
      return;
    }

    if (message.type === 'dns.zone.delegation') {
      if (!zonesRaw) return;
      const update = message.payload as { zoneId: string; verified: boolean; checkedAt: string };
      void refreshZones(
        (current) =>
          current?.map((zone) =>
            zone.id === update.zoneId
              ? { ...zone, delegationVerified: update.verified, delegationCheckedAt: update.checkedAt }
              : zone,
          ) ?? current,
        { revalidate: false },
      );
      return;
    }

    // Live-appends to whichever node's log panel is currently open, so a
    // user watching a "En attente" row can see exactly what the agent is
    // doing (package install, config write, service start...) instead of
    // just staring at a spinner - and if it fails, see why immediately
    // instead of guessing from a bare "Erreur" badge.
    if (message.type === 'agent-log.new') {
      const entry = message.payload as AgentLogItem;
      if (!expandedLogNodeId || entry.nodeId !== expandedLogNodeId) return;
      if (!/dns/i.test(entry.message)) return;
      setLogsByNode((prev) => ({ ...prev, [entry.nodeId]: [entry, ...(prev[entry.nodeId] ?? [])].slice(0, 50) }));
    }
  });

  const journal: DnsJournalState = { expandedLogKey, logsByNode, logsLoadingNodeId, toggleLogs };

  return {
    nodes,
    groups,
    zones,
    vlanId,
    groupsLoading,
    zonesLoading,
    refreshGroups,
    refreshZones,
    notice,
    setNotice,
    busyKey,
    setBusyKey,
    journal,
  };
}
