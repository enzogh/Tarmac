'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bell,
  BellOff,
  Cpu,
  FolderSearch,
  Gauge,
  GitCommitHorizontal,
  HardDrive,
  LayoutGrid,
  List,
  RefreshCcw,
  Search,
  Server,
  X,
} from 'lucide-react';
import { api, NodeActivityItem, NodeHeartbeatLiveEvent } from '@/lib/api';
import { usePolling } from '@/lib/hooks/usePolling';
import { useLiveSocket } from '@/lib/hooks/useLiveSocket';
import { GeoInfo, getGeoInfo } from '@/lib/geo';
import { clearLegacyNodeLabels, labelsByNode, readLegacyNodeLabels } from '@/lib/node-labels';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/PageHeader';
import { Callout } from '@/components/Callout';
import { NodeOnboardingModal } from '@/components/NodeOnboardingModal';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BannerSkeleton, NodesTableSkeleton, StatCardSkeleton } from '@/components/ui/skeleton';
import { Stat, StatRow } from '@/components/ui/stat';
import { Tabs, TabsContent, TabsCount, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ExplorationTab } from './components/ExplorationTab';
import { InternalDnsCard } from './components/InternalDnsCard';
import { DeleteNodeDialog, EditNodeDialog } from './components/NodeDialogs';
import { NodeDrawer } from './components/NodeDrawer';
import { externalIpOf, InternalDnsState, isMuted, nodeAttention, nodeGeo } from './components/node-ui';
import { NodesGrid } from './components/NodesGrid';
import { NodeAction, NodeSort, NodeSortKey, NodesTable } from './components/NodesTable';
import { PerformanceTab } from './components/PerformanceTab';

type Filter = 'all' | 'online' | 'degraded' | 'offline' | 'attention';
type ViewMode = 'table' | 'grid';
type Notice = { type: 'error' | 'success'; message: string };

const ANY = '__any__';
const VIEW_STORAGE_KEY = 'tarmac_nodes_view_v1';
const STATUS_RANK: Record<NodeActivityItem['status'], number> = { offline: 0, degraded: 1, online: 2 };

function FilterSelect({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-auto min-w-[8.5rem] gap-2 text-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{placeholder}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function InfrastructurePage() {
  // Heartbeats patch this list live (see useLiveSocket below); the poll only
  // refreshes what they don't carry (disks, SMART, DNS state), so it can be slow.
  const { data: nodesRaw, mutate: refreshNodes, isLoading: nodesLoading } = usePolling('activity:1h', () => api.nodes.activity(), {
    intervalMs: 30000,
  });
  const nodes = useMemo(() => nodesRaw ?? [], [nodesRaw]);
  const { data: internalDns, mutate: refreshInternalDns } = usePolling('dns-internal', api.dns.internal.getStatus, {
    intervalMs: 15000,
  });
  // Same value as the global version badge (VersionBadge.tsx), so the two
  // can never disagree about what "the current version" is.
  const { data: systemVersion } = usePolling('system:version', api.system.version, {
    intervalMs: 300000,
    redirectOnError: false,
  });
  const controlVersion = systemVersion?.version ?? null;

  // Patches the polled cache the instant a heartbeat arrives; polling stays
  // the source of truth. Bails out before the first poll has landed: an
  // updater returning undefined would poison the SWR cache for good.
  useLiveSocket((message) => {
    if (message.type === 'node.heartbeat') {
      if (!nodesRaw) return;
      const update = message.payload as NodeHeartbeatLiveEvent;
      void refreshNodes(
        (current) =>
          current?.map((node): NodeActivityItem =>
            node.id === update.nodeId
              ? {
                  ...node,
                  status: update.status,
                  lastSeenAt: update.lastSeenAt,
                  agentVersion: update.agentVersion,
                  agentVersionAt: update.agentVersionAt,
                  agentUpToDate: update.agentVersion && node.controlVersion ? update.agentVersion === node.controlVersion : null,
                  metrics: { ...update.metrics, sampledAt: update.lastSeenAt },
                  systemInfo: update.system ?? node.systemInfo,
                }
              : node,
          ) ?? current,
        { revalidate: false },
      );
      return;
    }
    if (message.type === 'dns.internal.status') {
      const update = message.payload as { status: InternalDnsState['internalDnsStatus']; error?: string | null };
      void refreshInternalDns(
        (current) => (current ? { ...current, internalDnsStatus: update.status, internalDnsError: update.error ?? null } : current),
        { revalidate: false },
      );
      return;
    }
    if (message.type === 'dns.internal.forwarder_status') {
      if (!nodesRaw) return;
      const update = message.payload as { nodeId: string; status: string; conflict: NodeActivityItem['internalDnsForwarderConflict'] };
      void refreshNodes(
        (current) =>
          current?.map((node) =>
            node.id === update.nodeId
              ? {
                  ...node,
                  internalDnsForwarderStatus: update.status as NodeActivityItem['internalDnsForwarderStatus'],
                  internalDnsForwarderConflict: update.conflict,
                }
              : node,
          ) ?? current,
        { revalidate: false },
      );
    }
  });

  const [activeTab, setActiveTab] = useState('nodes');
  const [view, setView] = useState<ViewMode>('table');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState(ANY);
  const [countryFilter, setCountryFilter] = useState(ANY);
  const [labelFilter, setLabelFilter] = useState(ANY);
  const [sort, setSort] = useState<NodeSort>({ key: 'status', direction: 'asc' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [editNode, setEditNode] = useState<NodeActivityItem | null>(null);
  const [nodeToDelete, setNodeToDelete] = useState<NodeActivityItem | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [dnsBusy, setDnsBusy] = useState(false);
  const [smartBusy, setSmartBusy] = useState(false);
  const [geoByIp, setGeoByIp] = useState<Record<string, GeoInfo | null>>({});

  const labels = useMemo(() => labelsByNode(nodes), [nodes]);

  // One-time move of the labels this browser kept locally (before they were
  // stored by the API) onto nodes that have none yet.
  useEffect(() => {
    if (!nodesRaw) return;
    const legacy = readLegacyNodeLabels();
    if (!legacy) return;
    const pending = nodesRaw.filter((node) => (node.labels ?? []).length === 0 && (legacy[node.id] ?? []).length > 0);
    clearLegacyNodeLabels();
    if (pending.length === 0) return;
    void Promise.all(pending.map((node) => api.nodes.update(node.id, { labels: legacy[node.id] }).catch(() => null))).then(() => refreshNodes());
  }, [nodesRaw, refreshNodes]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(VIEW_STORAGE_KEY);
      if (stored === 'grid' || stored === 'table') setView(stored);
    } catch {
      // Storage unavailable (private window): keep the default view.
    }
  }, []);
  const changeView = (next: ViewMode) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // Same as above.
    }
  };

  useEffect(() => {
    const ips = [...new Set(nodes.map(externalIpOf).filter((value): value is string => Boolean(value)))];
    const missing = ips.filter((ip) => !(ip in geoByIp));
    if (missing.length === 0) return;
    let cancelled = false;
    void Promise.all(missing.map((ip) => getGeoInfo(ip))).then((results) => {
      if (cancelled) return;
      setGeoByIp((prev) => {
        const next = { ...prev };
        missing.forEach((ip, index) => {
          next[ip] = results[index];
        });
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [nodes, geoByIp]);

  const geo = (node: NodeActivityItem) => nodeGeo(node, geoByIp);

  const stats = useMemo(() => {
    const online = nodes.filter((node) => node.status === 'online').length;
    const degraded = nodes.filter((node) => node.status === 'degraded').length;
    const offline = nodes.filter((node) => node.status === 'offline').length;
    const reachable = nodes.filter((node) => node.status !== 'offline');
    const avg = (pick: (node: NodeActivityItem) => number) =>
      reachable.length ? reachable.reduce((acc, node) => acc + pick(node), 0) / reachable.length : 0;
    const upToDate = nodes.filter((node) => node.agentUpToDate === true).length;
    const outdated = nodes.filter((node) => node.agentUpToDate === false).length;
    const smartIssues = nodes.reduce(
      (acc, node) =>
        node.smartMonitoringEnabled === false ? acc : acc + node.storage.disks.filter((disk) => disk.smart && disk.smart.overall !== 'healthy').length,
      0,
    );
    const attention = nodes.filter((node) => nodeAttention(node).length > 0).length;
    return { online, degraded, offline, avgCpu: avg((node) => node.metrics.cpu), avgRam: avg((node) => node.metrics.ram), upToDate, outdated, smartIssues, attention };
  }, [nodes]);

  const roleOptions = useMemo(() => [...new Set(nodes.map((node) => node.role))].sort().map((role) => ({ value: role, label: role })), [nodes]);
  const countryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    nodes.forEach((node) => {
      const country = geo(node)?.country;
      if (country) counts.set(country, (counts.get(country) ?? 0) + 1);
    });
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([country, count]) => ({ value: country, label: `${country} (${count})` }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, geoByIp]);
  const labelOptions = useMemo(
    () => [...new Set(nodes.flatMap((node) => labels[node.id] ?? []))].sort().map((label) => ({ value: label, label })),
    [nodes, labels],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = nodes.filter((node) => {
      if (filter === 'online' && node.status !== 'online') return false;
      if (filter === 'degraded' && node.status !== 'degraded') return false;
      if (filter === 'offline' && node.status !== 'offline') return false;
      if (filter === 'attention' && nodeAttention(node).length === 0) return false;
      if (roleFilter !== ANY && node.role !== roleFilter) return false;
      if (countryFilter !== ANY && geo(node)?.country !== countryFilter) return false;
      if (labelFilter !== ANY && !(labels[node.id] ?? []).includes(labelFilter)) return false;
      if (!needle) return true;
      const location = geo(node);
      return [node.name, node.role, externalIpOf(node), node.vlanIp, node.dnsHostname, location?.city, location?.country, ...(labels[node.id] ?? [])]
        .filter(Boolean)
        .some((value) => (value as string).toLowerCase().includes(needle));
    });
    const factor = sort.direction === 'asc' ? 1 : -1;
    const seen = (node: NodeActivityItem) => (node.lastSeenAt ? new Date(node.lastSeenAt).getTime() : 0);
    const compare: Record<NodeSortKey, (left: NodeActivityItem, right: NodeActivityItem) => number> = {
      status: (left, right) => STATUS_RANK[left.status] - STATUS_RANK[right.status] || nodeAttention(right).length - nodeAttention(left).length,
      name: (left, right) => left.name.localeCompare(right.name),
      location: (left, right) => (geo(left)?.city ?? '~').localeCompare(geo(right)?.city ?? '~'),
      cpu: (left, right) => right.metrics.cpu - left.metrics.cpu,
      ram: (left, right) => right.metrics.ram - left.metrics.ram,
      disk: (left, right) => right.storage.usageRatio - left.storage.usageRatio,
      network: (left, right) => right.metrics.networkRx + right.metrics.networkTx - (left.metrics.networkRx + left.metrics.networkTx),
      seen: (left, right) => seen(right) - seen(left),
    };
    return filtered.sort((left, right) => factor * compare[sort.key](left, right) || left.name.localeCompare(right.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, filter, query, roleFilter, countryFilter, labelFilter, labels, sort, geoByIp]);

  useEffect(() => {
    setSelected((current) => {
      const ids = new Set(nodes.map((node) => node.id));
      const next = new Set([...current].filter((id) => ids.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [nodes]);

  const opened = nodes.find((node) => node.id === openId) ?? null;
  const filtersActive = filter !== 'all' || query || roleFilter !== ANY || countryFilter !== ANY || labelFilter !== ANY;
  const resetFilters = () => {
    setFilter('all');
    setQuery('');
    setRoleFilter(ANY);
    setCountryFilter(ANY);
    setLabelFilter(ANY);
  };
  const onSort = (key: NodeSortKey) =>
    setSort((current) => (current.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' }));

  // --- actions --------------------------------------------------------

  const updateAgent = async (node: NodeActivityItem): Promise<boolean> => {
    setUpdatingIds((prev) => new Set(prev).add(node.id));
    try {
      return (await api.agents.update(node.id)).queued;
    } catch {
      return false;
    } finally {
      setUpdatingIds((prev) => {
        const next = new Set(prev);
        next.delete(node.id);
        return next;
      });
    }
  };

  const updateAgents = async (targets: NodeActivityItem[]) => {
    const eligible = targets.filter((node) => node.status === 'online' && node.agentUpToDate !== true);
    if (eligible.length === 0) {
      setNotice({ type: 'success', message: 'Les agents en ligne concernés sont déjà à jour.' });
      return;
    }
    setBulkBusy(true);
    try {
      const results = await Promise.all(eligible.map(updateAgent));
      const succeeded = results.filter(Boolean).length;
      const failed = results.length - succeeded;
      setNotice({
        type: failed === 0 ? 'success' : 'error',
        message:
          failed === 0
            ? `Mise à jour lancée sur ${succeeded} agent(s) (recompilation puis redémarrage du service).`
            : `Mise à jour lancée sur ${succeeded} agent(s), échec sur ${failed} (hors ligne entre-temps).`,
      });
    } finally {
      setBulkBusy(false);
    }
  };

  const setMute = async (targets: NodeActivityItem[], mute: boolean) => {
    setBulkBusy(true);
    try {
      await Promise.all(targets.map((node) => (mute ? api.nodes.mute(node.id, 60) : api.nodes.unmute(node.id))));
      setNotice({
        type: 'success',
        message: mute
          ? `Alertes en silence pendant 1 h sur ${targets.length} nœud(s) (maintenance).`
          : `Alertes réactivées sur ${targets.length} nœud(s).`,
      });
      await refreshNodes();
    } catch {
      setNotice({ type: 'error', message: 'Impossible de changer l’état de silence de certains nœuds.' });
    } finally {
      setBulkBusy(false);
    }
  };

  const designateDns = async (node: NodeActivityItem) => {
    const current = nodes.find((item) => item.id === internalDns?.internalDnsNodeId);
    if (current && current.id !== node.id && !window.confirm(`${current.name} est actuellement le DNS interne. Le transférer sur ${node.name} ?`)) return;
    setDnsBusy(true);
    try {
      await api.dns.internal.designate(node.id);
      await refreshInternalDns();
      setNotice({ type: 'success', message: `${node.name} est désigné DNS interne : installation en cours, le statut passe au vert dès confirmation de l’agent.` });
    } catch {
      setNotice({ type: 'error', message: `Impossible de désigner ${node.name} comme DNS interne.` });
    } finally {
      setDnsBusy(false);
    }
  };

  const clearDns = async (node: NodeActivityItem) => {
    if (!window.confirm(`Retirer le DNS interne de ${node.name} ? Les noms *.tarmac.local ne seront plus résolus dans la flotte.`)) return;
    setDnsBusy(true);
    try {
      await api.dns.internal.clear();
      await refreshInternalDns();
      setNotice({ type: 'success', message: 'DNS interne retiré.' });
    } catch {
      setNotice({ type: 'error', message: 'Impossible de retirer le DNS interne.' });
    } finally {
      setDnsBusy(false);
    }
  };

  const retryDns = async () => {
    setDnsBusy(true);
    try {
      await api.dns.internal.retry();
      await refreshInternalDns();
      setNotice({ type: 'success', message: 'Nouvelle tentative d’installation du DNS interne envoyée.' });
    } catch {
      setNotice({ type: 'error', message: 'Impossible de relancer l’installation : le nœud DNS est-il en ligne ?' });
    } finally {
      setDnsBusy(false);
    }
  };

  const resolveForwarder = async (node: NodeActivityItem) => {
    setDnsBusy(true);
    try {
      await api.dns.internal.resolveForwarderConflict(node.id);
      setNotice({ type: 'success', message: `Tentative de libération du port envoyée à ${node.name}.` });
      await refreshNodes();
    } catch {
      setNotice({ type: 'error', message: `Impossible d’envoyer la commande à ${node.name} (agent hors ligne ?).` });
    } finally {
      setDnsBusy(false);
    }
  };

  const toggleSmart = async (node: NodeActivityItem) => {
    setSmartBusy(true);
    try {
      await api.nodes.update(node.id, { smartMonitoringEnabled: node.smartMonitoringEnabled === false });
      await refreshNodes();
    } catch {
      setNotice({ type: 'error', message: `Impossible de modifier la surveillance SMART de ${node.name}.` });
    } finally {
      setSmartBusy(false);
    }
  };

  const saveNode = async (node: NodeActivityItem, values: { name: string; role: string; labels: string[]; dnsHostname: string | null }) => {
    await api.nodes.update(node.id, { name: values.name, role: values.role, dnsHostname: values.dnsHostname, labels: values.labels });
    await refreshNodes();
  };

  const deleteNode = async (node: NodeActivityItem) => {
    const result = await api.nodes.delete(node.id);
    setNotice(
      result.agentUninstallQueued
        ? { type: 'success', message: `${node.name} supprimé, désinstallation de l’agent en cours sur le serveur.` }
        : { type: 'error', message: `${node.name} supprimé, mais l’agent était hors ligne : désinstallez-le manuellement sur le serveur.` },
    );
    if (openId === node.id) setOpenId(null);
    setNodeToDelete(null);
    await refreshNodes();
  };

  const handleAction = (node: NodeActivityItem, action: NodeAction) => {
    if (action === 'open') setOpenId(node.id);
    if (action === 'edit') setEditNode(node);
    if (action === 'delete') setNodeToDelete(node);
    if (action === 'mute') void setMute([node], !isMuted(node));
    if (action === 'update') {
      void updateAgent(node).then((queued) =>
        setNotice(
          queued
            ? { type: 'success', message: `Mise à jour de ${node.name} lancée (recompilation puis redémarrage du service).` }
            : { type: 'error', message: `Impossible de mettre à jour ${node.name} : agent hors ligne.` },
        ),
      );
    }
  };

  const selectedNodes = nodes.filter((node) => selected.has(node.id));
  const outdatedOnline = nodes.filter((node) => node.status === 'online' && node.agentUpToDate === false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nœuds"
        description="Vos serveurs, leur état en temps réel et leurs rôles dans la flotte. Cliquez sur un nœud pour le détail, ses disques et son DNS."
        actions={
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button variant="secondary" onClick={() => void updateAgents(nodes)} disabled={bulkBusy || outdatedOnline.length === 0} className="gap-1.5">
                    <RefreshCcw className={cn('h-4 w-4', bulkBusy && 'animate-spin')} />
                    {outdatedOnline.length > 0 ? `Mettre à jour ${outdatedOnline.length} agent(s)` : 'Agents à jour'}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Recompile et redémarre l’agent sur chaque nœud en ligne dont la version diffère du contrôleur
                {controlVersion ? ` (réf. ${controlVersion})` : ''}.
              </TooltipContent>
            </Tooltip>
            <NodeOnboardingModal onCreated={refreshNodes} />
          </>
        }
      />

      {notice && (
        <Callout variant={notice.type === 'error' ? 'danger' : 'success'}>
          <span className="flex items-start justify-between gap-3">
            {notice.message}
            <button type="button" onClick={() => setNotice(null)} aria-label="Fermer" className="shrink-0 opacity-70 hover:opacity-100">
              <X className="h-4 w-4" />
            </button>
          </span>
        </Callout>
      )}

      {nodesLoading ? (
        <StatRow className="xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <StatCardSkeleton key={index} />
          ))}
        </StatRow>
      ) : (
        <StatRow className="animate-fade-in xl:grid-cols-5">
          <Stat
            label="Nœuds en ligne"
            value={stats.online}
            unit={`/ ${nodes.length}`}
            icon={Server}
            tone={stats.offline > 0 ? 'danger' : stats.degraded > 0 ? 'warn' : 'ok'}
            hint={stats.offline > 0 || stats.degraded > 0 ? `${stats.offline} hors ligne · ${stats.degraded} dégradé(s)` : 'Tous nominaux'}
          />
          <Stat label="CPU moyen" value={Math.round(stats.avgCpu)} unit="%" icon={Cpu} tone={stats.avgCpu >= 85 ? 'danger' : stats.avgCpu >= 65 ? 'warn' : 'neutral'} hint="Sur les nœuds joignables" />
          <Stat label="RAM moyenne" value={Math.round(stats.avgRam)} unit="%" icon={Gauge} tone={stats.avgRam >= 85 ? 'danger' : stats.avgRam >= 65 ? 'warn' : 'neutral'} hint="Sur les nœuds joignables" />
          <Stat
            label="Disques SMART"
            value={stats.smartIssues}
            icon={HardDrive}
            tone={stats.smartIssues > 0 ? 'danger' : 'ok'}
            hint={stats.smartIssues > 0 ? 'À remplacer rapidement' : 'Aucune anomalie'}
          />
          <Stat
            label="Agents à jour"
            value={stats.upToDate}
            unit={`/ ${nodes.length}`}
            icon={GitCommitHorizontal}
            tone={nodes.length === 0 ? 'neutral' : stats.outdated === 0 ? 'ok' : 'warn'}
            hint={controlVersion ? `réf. ${controlVersion}` : 'Version de référence inconnue'}
          />
        </StatRow>
      )}

      {!internalDns && nodesLoading && <BannerSkeleton />}
      <InternalDnsCard
        state={internalDns}
        nodes={nodes}
        onOpenNode={(node) => setOpenId(node.id)}
        onRetry={() => void retryDns()}
        retrying={dnsBusy}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="nodes" className="gap-1.5">
            <Server className="h-3.5 w-3.5" />
            Nœuds <TabsCount>{nodes.length}</TabsCount>
          </TabsTrigger>
          <TabsTrigger value="performance" className="gap-1.5">
            <Activity className="h-3.5 w-3.5" />
            Performance
          </TabsTrigger>
          <TabsTrigger value="exploration" className="gap-1.5">
            <FolderSearch className="h-3.5 w-3.5" />
            Exploration
          </TabsTrigger>
        </TabsList>

        <TabsContent value="nodes" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)}>
              <TabsList variant="segmented">
                <TabsTrigger value="all">
                  Tous <TabsCount>{nodes.length}</TabsCount>
                </TabsTrigger>
                <TabsTrigger value="online">
                  En ligne <TabsCount>{stats.online}</TabsCount>
                </TabsTrigger>
                {stats.degraded > 0 && (
                  <TabsTrigger value="degraded">
                    Dégradés <TabsCount>{stats.degraded}</TabsCount>
                  </TabsTrigger>
                )}
                <TabsTrigger value="offline">
                  Hors ligne <TabsCount>{stats.offline}</TabsCount>
                </TabsTrigger>
                <TabsTrigger value="attention">
                  À surveiller <TabsCount>{stats.attention}</TabsCount>
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nom, IP, ville, libellé…" className="h-8 pl-8" />
            </div>
            {countryOptions.length > 1 && <FilterSelect value={countryFilter} onChange={setCountryFilter} placeholder="Tous les pays" options={countryOptions} />}
            {roleOptions.length > 1 && <FilterSelect value={roleFilter} onChange={setRoleFilter} placeholder="Tous les rôles" options={roleOptions} />}
            {labelOptions.length > 0 && <FilterSelect value={labelFilter} onChange={setLabelFilter} placeholder="Tous les libellés" options={labelOptions} />}
            {filtersActive && (
              <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1">
                <X className="h-3.5 w-3.5" />
                Réinitialiser
              </Button>
            )}
            <span className="flex-1" />
            <div className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5" role="group" aria-label="Affichage">
              {(
                [
                  { value: 'table', icon: List, label: 'Tableau' },
                  { value: 'grid', icon: LayoutGrid, label: 'Grille' },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => changeView(option.value)}
                  aria-pressed={view === option.value}
                  title={option.label}
                  className={cn(
                    'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors',
                    view === option.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <option.icon className="h-3.5 w-3.5" />
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {selected.size > 0 && view === 'table' && (
            <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-popover/95 px-3 py-2 shadow-overlay backdrop-blur animate-fade-in">
              <span className="text-sm font-medium text-foreground">
                {selected.size} nœud{selected.size > 1 ? 's' : ''} sélectionné{selected.size > 1 ? 's' : ''}
              </span>
              <span className="mx-1 h-5 w-px bg-border" />
              <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={() => void updateAgents(selectedNodes)} className="gap-1.5">
                <RefreshCcw className="h-3.5 w-3.5" />
                Mettre à jour les agents
              </Button>
              <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={() => void setMute(selectedNodes, true)} className="gap-1.5">
                <BellOff className="h-3.5 w-3.5" />
                Silence 1 h
              </Button>
              <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={() => void setMute(selectedNodes, false)} className="gap-1.5">
                <Bell className="h-3.5 w-3.5" />
                Réactiver les alertes
              </Button>
              <span className="flex-1" />
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} aria-label="Vider la sélection">
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {nodesLoading ? (
            <Card className="overflow-hidden">
              <NodesTableSkeleton />
            </Card>
          ) : nodes.length === 0 ? (
            <Card className="py-12 text-center text-sm text-muted-foreground">Aucun nœud enregistré. Cliquez sur « Onboarder un nœud » pour commencer.</Card>
          ) : visible.length === 0 ? (
            <Card className="flex flex-col items-center gap-2 py-12 text-center">
              <p className="text-sm text-muted-foreground">Aucun nœud ne correspond à ces filtres.</p>
              <Button variant="secondary" size="sm" onClick={resetFilters}>
                Réinitialiser les filtres
              </Button>
            </Card>
          ) : (
            <Card className="overflow-hidden animate-fade-in">
              {view === 'table' ? (
                <NodesTable
                  nodes={visible}
                  geo={geo}
                  labels={labels}
                  selected={selected}
                  onSelectedChange={setSelected}
                  sort={sort}
                  onSort={onSort}
                  internalDns={internalDns}
                  updatingIds={updatingIds}
                  activeId={openId}
                  onAction={handleAction}
                />
              ) : (
                <NodesGrid nodes={visible} geo={geo} internalDns={internalDns} activeId={openId} onOpen={(node) => setOpenId(node.id)} />
              )}
              <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
                {visible.length === nodes.length ? `${nodes.length} nœuds` : `${visible.length} sur ${nodes.length} nœuds`}
              </div>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="performance">
          {activeTab === 'performance' && <PerformanceTab nodes={nodes} loading={nodesLoading} labels={labels} onOpenNode={(node) => setOpenId(node.id)} />}
        </TabsContent>
        <TabsContent value="exploration">{activeTab === 'exploration' && <ExplorationTab nodes={nodes} />}</TabsContent>
      </Tabs>

      <NodeDrawer
        node={opened}
        geo={opened ? geo(opened) : null}
        labels={opened ? (labels[opened.id] ?? []) : []}
        internalDns={internalDns}
        dnsBusy={dnsBusy}
        updating={opened ? updatingIds.has(opened.id) : false}
        smartBusy={smartBusy}
        onOpenChange={(open) => !open && setOpenId(null)}
        onEdit={() => opened && setEditNode(opened)}
        onUpdateAgent={() => opened && handleAction(opened, 'update')}
        onToggleMute={() => opened && void setMute([opened], !isMuted(opened))}
        onDelete={() => opened && setNodeToDelete(opened)}
        onToggleSmart={() => opened && void toggleSmart(opened)}
        onDesignateDns={() => opened && void designateDns(opened)}
        onClearDns={() => opened && void clearDns(opened)}
        onRetryDns={() => void retryDns()}
        onResolveForwarder={() => opened && void resolveForwarder(opened)}
      />
      <EditNodeDialog
        node={editNode}
        labels={editNode ? (labels[editNode.id] ?? []) : []}
        onOpenChange={(open) => !open && setEditNode(null)}
        onSave={(values) => (editNode ? saveNode(editNode, values) : Promise.resolve())}
      />
      <DeleteNodeDialog node={nodeToDelete} onOpenChange={(open) => !open && setNodeToDelete(null)} onConfirm={deleteNode} />
    </div>
  );
}
