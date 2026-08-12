'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowUpToLine,
  Bell,
  BellOff,
  Cpu,
  Eye,
  FolderSearch,
  Gauge,
  GitCommitHorizontal,
  Globe2,
  HardDrive,
  type LucideIcon,
  Pencil,
  RefreshCcw,
  Server,
  Thermometer,
  Trash2,
} from 'lucide-react';
import { api, DirectoryScanEntry, NodeActivityItem, NodeMetricSample, SmartHistoryPoint } from '../../../../lib/api';
import { usePolling } from '../../../../lib/hooks/usePolling';
import { CardListSkeleton, ChartCardSkeleton, StatCardSkeleton } from '../../../../components/ui/skeleton';
import { GeoInfo, flagFromCountryCode, getGeoInfo, normalizeCountryCode, parseHostFromEndpoint } from '../../../../lib/geo';
import { readNodeLabels, writeNodeLabels } from '../../../../lib/node-labels';
import { meterTone } from '../../../../lib/utils';
import { PageHeader } from '../../../../components/PageHeader';
import { Callout } from '../../../../components/Callout';
import { SmartTrendChart } from '../../../../components/dashboard-charts';
import { ServerTrendCard } from '../../../../components/ServerTrendCard';
import { NodeComparisonChart } from '../../../../components/dashboard-charts';
import { StatCard, Badge, NodeLabelBadges } from '../../../../components/ui';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../components/ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../../components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../../../components/ui/dialog';
import { NodeOnboardingModal } from '../../../../components/NodeOnboardingModal';
import { Progress } from '../../../../components/ui/progress';
import { DirectoryBrowser } from '../../../../components/ui/directory-browser';
import { SectionLabel } from '../../../../components/SectionLabel';

const formatMbps = (value: number) => `${((value * 8) / 1_000_000).toFixed(2)} MB/s`;

const formatBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const base = Math.log(value) / Math.log(1024);
  const index = Math.min(units.length - 1, Math.max(0, Math.floor(base)));
  const scaled = value / 1024 ** index;
  return `${scaled >= 10 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[index]}`;
};

const formatDateTime = (value?: string | null) => (value ? new Date(value).toLocaleString('fr-FR') : '-');

function NodeMeter({
  icon: Icon,
  label,
  value,
  suffix,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  suffix?: string;
}) {
  const tone = meterTone(value);
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </span>
        <span className={`font-medium ${tone.text}`}>{Math.round(value)}%</span>
      </div>
      <Progress value={value} className="mt-1.5 h-1.5" indicatorClassName={`bg-gradient-to-r ${tone.bar}`} />
      {suffix && <p className="mt-1 truncate text-[11px] text-muted-foreground">{suffix}</p>}
    </div>
  );
}

export default function InfrastructurePage() {
  const { data: nodes = [], mutate: refreshNodes, isLoading: nodesLoading } = usePolling('activity:1h', () => api.nodes.activity());
  // Fetched directly rather than derived from `nodes` (which used to leave
  // it null whenever the fleet was empty, falling back to a confusing
  // "réf. inconnue" string) - this is the exact same value the bottom-right
  // global version badge shows (see VersionBadge.tsx), so the two can never
  // disagree about what "the current version" is.
  const { data: systemVersion, isLoading: systemVersionLoading } = usePolling('system:version', api.system.version, {
    intervalMs: 300000,
    redirectOnError: false,
  });
  const controlVersion = systemVersion?.version ?? null;

  const sortedByCpu = useMemo(
    () => [...nodes].sort((left, right) => right.metrics.cpu - left.metrics.cpu),
    [nodes],
  );
  const topNodeIds = useMemo(() => sortedByCpu.slice(0, 6).map((node) => node.id), [sortedByCpu]);
  const nodeDetailGrid = useMemo(() => sortedByCpu.slice(0, 6), [sortedByCpu]);

  const { data: samplesByNode = {} } = usePolling(
    topNodeIds.length > 0 ? `metrics:${topNodeIds.join(',')}:6h` : null,
    async () => {
      const histories = await Promise.all(
        topNodeIds.map(async (id) => [id, await api.nodes.metrics(id, '6h')] as const),
      );
      return Object.fromEntries(histories) as Record<string, NodeMetricSample[]>;
    },
  );

  const [editNode, setEditNode] = useState<NodeActivityItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editLabels, setEditLabels] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [nodeToDelete, setNodeToDelete] = useState<NodeActivityItem | null>(null);
  const [inspectingNode, setInspectingNode] = useState<NodeActivityItem | null>(null);
  const [smartNode, setSmartNode] = useState<NodeActivityItem | null>(null);
  const [expandedSmartDiskId, setExpandedSmartDiskId] = useState<string | null>(null);
  const [smartHistoryByDisk, setSmartHistoryByDisk] = useState<Record<string, SmartHistoryPoint[]>>({});
  const [smartHistoryLoading, setSmartHistoryLoading] = useState<string | null>(null);

  const toggleSmartHistory = async (nodeId: string, disk: NodeActivityItem['storage']['disks'][number]) => {
    if (expandedSmartDiskId === disk.id) {
      setExpandedSmartDiskId(null);
      return;
    }
    setExpandedSmartDiskId(disk.id);
    if (!disk.smartDiskName || smartHistoryByDisk[disk.id]) return;
    setSmartHistoryLoading(disk.id);
    try {
      const history = await api.nodes.smartHistory(nodeId, disk.smartDiskName);
      setSmartHistoryByDisk((prev) => ({ ...prev, [disk.id]: history }));
    } catch {
      setSmartHistoryByDisk((prev) => ({ ...prev, [disk.id]: [] }));
    } finally {
      setSmartHistoryLoading(null);
    }
  };

  useEffect(() => {
    if (!smartNode) return;
    const disksToFetch = smartNode.storage.disks.filter((disk) => disk.smartDiskName && !smartHistoryByDisk[disk.id]);
    if (disksToFetch.length === 0) return;
    void (async () => {
      const entries = await Promise.all(
        disksToFetch.map(async (disk) => {
          try {
            return [disk.id, await api.nodes.smartHistory(smartNode.id, disk.smartDiskName!)] as const;
          } catch {
            return [disk.id, [] as SmartHistoryPoint[]] as const;
          }
        }),
      );
      setSmartHistoryByDisk((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smartNode]);
  const [updatingNodeIds, setUpdatingNodeIds] = useState<Set<string>>(new Set());
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [updateNotice, setUpdateNotice] = useState<{ type: 'error' | 'success'; message: string } | null>(null);
  const [nodeLabels, setNodeLabels] = useState<Record<string, string[]>>({});
  const [geoByIp, setGeoByIp] = useState<Record<string, GeoInfo | null>>({});

  const [selectedExplorerNodeId, setSelectedExplorerNodeId] = useState<string>('');
  const [browsePath, setBrowsePath] = useState('/');
  const [selectedPath, setSelectedPath] = useState('/');
  const [directories, setDirectories] = useState<string[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanResults, setScanResults] = useState<DirectoryScanEntry[]>([]);
  const [scanTruncated, setScanTruncated] = useState(false);

  const loadNodeDirectories = async (nodeId: string, basePath: string) => {
    if (!nodeId) return;
    setDirectoryLoading(true);
    try {
      const payload = await api.migrations.listDirectories(nodeId, basePath || '/');
      setBrowsePath(payload.basePath);
      setDirectories([...payload.directories].sort((a, b) => a.localeCompare(b)));
    } catch {
      setDirectories([]);
      setUpdateNotice({
        type: 'error',
        message: 'Navigation distante indisponible sur ce nœud (agent offline ou accès refusé).',
      });
    } finally {
      setDirectoryLoading(false);
    }
  };

  const runDirectoryScan = async () => {
    if (!selectedExplorerNodeId) return;
    setScanLoading(true);
    try {
      const payload = await api.migrations.scanDirectories(selectedExplorerNodeId, selectedPath || browsePath, 20);
      setScanResults(payload.entries);
      setScanTruncated(payload.truncated);
    } catch {
      setScanResults([]);
      setScanTruncated(false);
      setUpdateNotice({
        type: 'error',
        message: 'Scan volumétrique indisponible. Vérifiez la connectivité de l’agent.',
      });
    } finally {
      setScanLoading(false);
    }
  };

  useEffect(() => {
    setNodeLabels(readNodeLabels());
  }, []);

  useEffect(() => {
    if (nodes.length === 0) return;
    if (!selectedExplorerNodeId || !nodes.some((node) => node.id === selectedExplorerNodeId)) {
      const preferred = nodes.find((node) => node.status === 'online') ?? nodes[0];
      setSelectedExplorerNodeId(preferred.id);
      setBrowsePath('/');
      setSelectedPath('/');
      setDirectories([]);
      setScanResults([]);
      setScanTruncated(false);
    }
  }, [nodes, selectedExplorerNodeId]);

  useEffect(() => {
    if (!selectedExplorerNodeId) return;
    void loadNodeDirectories(selectedExplorerNodeId, '/');
  }, [selectedExplorerNodeId]);

  useEffect(() => {
    const ips = Array.from(
      new Set(
        nodes
          .map((node) => parseHostFromEndpoint(node.externalIp || node.overlayEndpoint))
          .filter((value): value is string => Boolean(value)),
      ),
    );
    if (ips.length === 0) return;

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

  const deleteNode = async (node: NodeActivityItem) => {
    const result = await api.nodes.delete(node.id);
    setUpdateNotice(
      result.agentUninstallQueued
        ? { type: 'success', message: `${node.name} supprimé, désinstallation de l’agent en cours sur le serveur.` }
        : {
            type: 'error',
            message: `${node.name} supprimé, mais l’agent était hors ligne : désinstallez-le manuellement sur le serveur.`,
          },
    );
    await refreshNodes();
    setNodeToDelete(null);
  };

  const openEditModal = (node: NodeActivityItem) => {
    setEditNode(node);
    setEditName(node.name);
    setEditRole(node.role);
    setEditLabels((nodeLabels[node.id] ?? []).join(', '));
  };

  const saveEditNode = async (e: FormEvent) => {
    e.preventDefault();
    if (!editNode) return;
    setEditLoading(true);
    try {
      await api.nodes.update(editNode.id, { name: editName, role: editRole });
      const labels = editLabels
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .slice(0, 6);
      setNodeLabels((prev) => {
        const next = { ...prev, [editNode.id]: labels };
        writeNodeLabels(next);
        return next;
      });
      await refreshNodes();
      setEditNode(null);
    } finally {
      setEditLoading(false);
    }
  };

  const updateSingleAgent = async (node: NodeActivityItem): Promise<boolean> => {
    setUpdatingNodeIds((prev) => new Set(prev).add(node.id));
    try {
      const result = await api.agents.update(node.id);
      return result.queued;
    } catch {
      return false;
    } finally {
      setUpdatingNodeIds((prev) => {
        const next = new Set(prev);
        next.delete(node.id);
        return next;
      });
    }
  };

  const triggerAgentUpdate = async (node: NodeActivityItem) => {
    const success = await updateSingleAgent(node);
    setUpdateNotice(
      success
        ? { type: 'success', message: `Mise à jour de ${node.name} lancée (recompile + restart du service).` }
        : { type: 'error', message: `Impossible de mettre à jour ${node.name}: agent hors ligne.` },
    );
  };

  const triggerAgentUpdateAll = async () => {
    const targets = nodes.filter((node) => node.status === 'online' && node.agentUpToDate !== true);
    if (targets.length === 0) {
      setUpdateNotice({ type: 'success', message: 'Tous les agents en ligne sont déjà à jour.' });
      return;
    }
    setBulkUpdating(true);
    try {
      const results = await Promise.all(targets.map((node) => updateSingleAgent(node)));
      const succeeded = results.filter(Boolean).length;
      const failed = results.length - succeeded;
      setUpdateNotice({
        type: failed === 0 ? 'success' : 'error',
        message:
          failed === 0
            ? `Mise à jour lancée sur ${succeeded} agent(s).`
            : `Mise à jour lancée sur ${succeeded} agent(s), échec sur ${failed} (agent hors ligne entre-temps).`,
      });
    } finally {
      setBulkUpdating(false);
    }
  };

  const isMuted = (node: NodeActivityItem) => !!node.mutedUntil && new Date(node.mutedUntil).getTime() > Date.now();

  const toggleMute = async (node: NodeActivityItem) => {
    try {
      if (isMuted(node)) {
        await api.nodes.unmute(node.id);
        setUpdateNotice({ type: 'success', message: `Alertes réactivées pour ${node.name}.` });
      } else {
        await api.nodes.mute(node.id, 60);
        setUpdateNotice({
          type: 'success',
          message: `Alertes mises en silence pour ${node.name} pendant 1h (maintenance).`,
        });
      }
      await refreshNodes();
    } catch {
      setUpdateNotice({ type: 'error', message: `Impossible de changer l’état de silence pour ${node.name}.` });
    }
  };

  const { onlineNodes, degradedNodes, avgCpu, avgRam, upToDateNodes, outdatedNodes, fleetVersionAligned, disksWithSmartIssues } = useMemo(() => {
    const onlineNodes = nodes.filter((node) => node.status === 'online').length;
    const degradedNodes = nodes.filter((node) => node.status === 'degraded').length;
    const avgCpu = nodes.length ? nodes.reduce((acc, node) => acc + node.metrics.cpu, 0) / nodes.length : 0;
    const avgRam = nodes.length ? nodes.reduce((acc, node) => acc + node.metrics.ram, 0) / nodes.length : 0;

    const upToDateNodes = nodes.filter((node) => node.agentUpToDate === true).length;
    const outdatedNodes = nodes.filter((node) => node.agentUpToDate === false).length;
    const fleetVersionAligned = nodes.length > 0 && outdatedNodes === 0 && upToDateNodes === nodes.length;
    const disksWithSmartIssues = nodes.reduce(
      (acc, node) =>
        acc + node.storage.disks.filter((disk) => disk.smart && disk.smart.overall !== 'healthy').length,
      0,
    );

    return { onlineNodes, degradedNodes, avgCpu, avgRam, upToDateNodes, outdatedNodes, fleetVersionAligned, disksWithSmartIssues };
  }, [nodes]);

  const versionBadge = (node: NodeActivityItem) => {
    if (!node.agentVersion) {
      return { type: 'info' as const, label: 'Version inconnue' };
    }
    if (node.agentUpToDate) {
      return { type: 'success' as const, label: node.agentVersion };
    }
    return { type: 'warning' as const, label: `${node.agentVersion} obsolète` };
  };

  const selectedExplorerNode = nodes.find((node) => node.id === selectedExplorerNodeId) ?? null;
  const scanMax = scanResults[0]?.sizeBytes ?? 1;
  const nodeComparisonData = useMemo(
    () =>
      nodes.map((node) => ({
        name: node.name,
        cpu: Math.round(node.metrics.cpu),
        ram: Math.round(node.metrics.ram),
      })),
    [nodes],
  );

  const getExternalIp = (node: NodeActivityItem) =>
    parseHostFromEndpoint(node.externalIp || node.overlayEndpoint) ?? '-';
  // Location edited by hand (Réseau > nœud) always wins over the IP-based
  // GeoIP lookup, which is only a fallback for nodes nobody has corrected yet.
  const getNodeGeo = (node: NodeActivityItem): GeoInfo | null => {
    const ip = parseHostFromEndpoint(node.externalIp || node.overlayEndpoint);
    const auto = ip ? geoByIp[ip] : null;
    const hasOverride = Boolean(node.locationCity || node.locationCountry || node.locationCountryCode);
    if (!hasOverride && !auto) return null;
    return {
      ip: ip ?? auto?.ip ?? '',
      city: node.locationCity?.trim() || auto?.city || null,
      country: node.locationCountry?.trim() || auto?.country || null,
      countryCode: normalizeCountryCode(node.locationCountryCode) ?? auto?.countryCode ?? null,
      latitude: node.locationLat ?? auto?.latitude ?? null,
      longitude: node.locationLng ?? auto?.longitude ?? null,
    };
  };

  return (
      <div className="space-y-8">
        <PageHeader
          icon={Server}
          title="Infrastructure"
          description="Pilotage des nœuds, monitoring temps réel, scan volumétrique des dossiers et opérations agent sans CLI."
        />

        {updateNotice && (
          <div
            className={`rounded-xl border px-4 py-3 text-sm ${
              updateNotice.type === 'error'
                ? 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
            }`}
          >
            {updateNotice.message}
          </div>
        )}

        <section className="space-y-4">
          <SectionLabel>Aperçu</SectionLabel>
          {nodesLoading ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
              {Array.from({ length: 6 }).map((_, index) => (
                <StatCardSkeleton key={index} />
              ))}
            </div>
          ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6 animate-fade-in">
            <StatCard label="Nœuds online" value={onlineNodes} icon={<Server className="h-8 w-8" />} changeType="up" />
            <StatCard
              label="Nœuds dégradés"
              value={degradedNodes}
              icon={<Gauge className="h-8 w-8" />}
              changeType={degradedNodes > 0 ? 'neutral' : 'up'}
            />
            <StatCard label="CPU moyen" value={`${Math.round(avgCpu)}%`} icon={<Cpu className="h-8 w-8" />} changeType="neutral" />
            <StatCard label="RAM moyenne" value={`${Math.round(avgRam)}%`} icon={<HardDrive className="h-8 w-8" />} changeType="neutral" />
            <StatCard
              label="Disques en alerte SMART"
              value={disksWithSmartIssues}
              icon={<HardDrive className="h-8 w-8" />}
              changeType={disksWithSmartIssues > 0 ? 'down' : 'up'}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <StatCard
                    label="Version agent"
                    value={`${upToDateNodes}/${nodes.length}`}
                    change={controlVersion ? `réf. ${controlVersion}` : undefined}
                    changeType={nodes.length === 0 ? 'neutral' : fleetVersionAligned ? 'up' : 'down'}
                    icon={<GitCommitHorizontal className="h-8 w-8" />}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {nodes.length === 0
                  ? 'Aucun nœud enregistré'
                  : fleetVersionAligned
                    ? 'Tous les agents tournent sur le même commit que le contrôleur'
                    : `${outdatedNodes} nœud(s) à mettre à jour vers ${controlVersion ?? 'la dernière version'}`}
              </TooltipContent>
            </Tooltip>
          </div>
          )}
        </section>

        <Tabs defaultValue="nodes" className="space-y-4">
          <TabsList>
            <TabsTrigger value="nodes" className="gap-1.5">
              <Server className="h-3.5 w-3.5" />
              Nœuds
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

          <TabsContent value="performance">
          {nodesLoading ? (
            <div className="space-y-4">
              <ChartCardSkeleton />
              <CardListSkeleton cards={4} />
            </div>
          ) : (
          <div className="space-y-6 animate-fade-in">
          <section className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <SectionLabel>Comparaison CPU / RAM par nœud</SectionLabel>
              <p className="text-xs text-muted-foreground">
                Moyenne flotte : <span className="font-medium text-foreground">{Math.round(avgCpu)}% CPU</span> ·{' '}
                <span className="font-medium text-foreground">{Math.round(avgRam)}% RAM</span>
              </p>
            </div>
            <Card className="border-white/[0.08] bg-panel-glow">
              <CardContent className="pt-6">
                <NodeComparisonChart data={nodeComparisonData} />
              </CardContent>
            </Card>
          </section>

          <section className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <SectionLabel>Détail par nœud</SectionLabel>
              <p className="text-xs text-muted-foreground">Triés par charge CPU décroissante, 6 nœuds les plus actifs</p>
            </div>
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {nodeDetailGrid.map((node) => (
                <ServerTrendCard
                  key={node.id}
                  node={node}
                  samples={samplesByNode[node.id] ?? []}
                  labels={nodeLabels[node.id] ?? []}
                />
              ))}
              {nodes.length === 0 && (
                <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
                  Aucun nœud détecté pour le moment.
                </p>
              )}
            </div>
          </section>
          </div>
          )}
          </TabsContent>

          <TabsContent value="exploration">
          <Callout>
            Parcourez les dossiers d'un nœud puis lancez un scan volumétrique pour repérer les répertoires les plus lourds.
          </Callout>
          <div className="grid gap-4 xl:grid-cols-[1.25fr_minmax(0,1fr)]">
          <Card className="border-white/[0.08] bg-zinc-900/65">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FolderSearch className="h-4 w-4 text-violet-300" />
                Navigateur de dossiers par nœud
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {nodes.map((node) => {
                  const selected = selectedExplorerNodeId === node.id;
                  return (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => {
                        setSelectedExplorerNodeId(node.id);
                        setBrowsePath('/');
                        setSelectedPath('/');
                        setDirectories([]);
                        setScanResults([]);
                        setScanTruncated(false);
                      }}
                      className={`rounded-xl border px-3 py-2 text-left transition ${
                        selected
                          ? 'border-violet-400/40 bg-violet-500/15 text-violet-100'
                          : 'border-white/[0.08] bg-zinc-950/50 text-zinc-200 hover:border-violet-400/25'
                      }`}
                    >
                      <p className="truncate text-sm font-medium">{node.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{node.role}</p>
                    </button>
                  );
                })}
              </div>

              <DirectoryBrowser
                title={selectedExplorerNode ? `Exploration: ${selectedExplorerNode.name}` : 'Exploration'}
                description="Navigation live distante via agent. Sélectionnez un dossier puis lancez le scan volumétrique."
                currentPath={browsePath}
                selectedPath={selectedPath}
                directories={directories}
                loading={directoryLoading}
                disabled={!selectedExplorerNodeId}
                onBrowse={(path) => {
                  if (!selectedExplorerNodeId) return;
                  void loadNodeDirectories(selectedExplorerNodeId, path);
                }}
                onSelect={(path) => setSelectedPath(path)}
              />
            </CardContent>
          </Card>

          <Card className="border-white/[0.08] bg-zinc-900/65">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <HardDrive className="h-4 w-4 text-cyan-300" />
                Scan dossiers volumineux
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-white/[0.08] bg-zinc-950/50 p-3 text-xs text-muted-foreground">
                <p className="font-mono text-zinc-200">{selectedPath || browsePath}</p>
                <p className="mt-1">
                  Lance un top des dossiers les plus lourds du chemin courant pour accélérer le diagnostic.
                </p>
              </div>
              <Button
                onClick={() => void runDirectoryScan()}
                disabled={!selectedExplorerNodeId || scanLoading}
                className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500"
              >
                <RefreshCcw className={`mr-2 h-4 w-4 ${scanLoading ? 'animate-spin' : ''}`} />
                {scanLoading ? 'Scan en cours…' : 'Scanner les dossiers volumineux'}
              </Button>

              <div className="space-y-2">
                {scanResults.map((entry) => (
                  <div key={entry.path} className="rounded-xl border border-white/[0.08] bg-zinc-950/50 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                      <p className="truncate font-mono text-zinc-200">{entry.path}</p>
                      <p className="shrink-0 font-semibold text-cyan-200">{formatBytes(entry.sizeBytes)}</p>
                    </div>
                    <Progress value={(entry.sizeBytes / scanMax) * 100} className="h-1.5" />
                  </div>
                ))}
                {!scanLoading && scanResults.length === 0 && (
                  <p className="rounded-xl border border-dashed border-white/10 bg-zinc-950/40 px-3 py-4 text-center text-xs text-muted-foreground">
                    Aucun résultat de scan pour le moment.
                  </p>
                )}
                {scanTruncated && (
                  <p className="text-[11px] text-amber-300">
                    Résultat partiel: scan borné pour préserver la réactivité.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
          </div>
          </TabsContent>

          <TabsContent value="nodes">
          <Card className="border-white/[0.08] bg-zinc-900/65">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Server className="h-5 w-5 text-violet-400" />
                <CardTitle>Nœuds (serveurs)</CardTitle>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        variant="secondary"
                        onClick={() => void triggerAgentUpdateAll()}
                        disabled={bulkUpdating || nodes.every((n) => n.status !== 'online' || n.agentUpToDate === true)}
                        className="gap-2"
                      >
                        <RefreshCcw className={`h-4 w-4 ${bulkUpdating ? 'animate-spin' : ''}`} />
                        {bulkUpdating ? 'Mise à jour en cours…' : 'Mettre à jour tous les agents'}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    Recompile + redémarre l’agent sur chaque nœud en ligne dont la version diffère du contrôleur
                    ({controlVersion ? `réf. ${controlVersion}` : systemVersionLoading ? 'chargement de la référence…' : 'référence indisponible sur ce contrôleur'})
                  </TooltipContent>
                </Tooltip>
                <NodeOnboardingModal onCreated={refreshNodes} />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {nodesLoading && <CardListSkeleton cards={4} />}
            {!nodesLoading && (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 animate-fade-in">
              {nodes.map((node) => {
                const geo = getNodeGeo(node);
                const labels = nodeLabels[node.id] ?? [];
                const statusDotClass =
                  node.status === 'online' ? 'bg-emerald-400' : node.status === 'degraded' ? 'bg-amber-400' : 'bg-rose-400';
                const smartIssue = node.storage.disks.some((disk) => disk.smart && disk.smart.overall !== 'healthy');

                return (
                  <div
                    key={node.id}
                    className="rounded-2xl border border-white/[0.08] bg-panel-glow p-5 transition-colors hover:border-white/[0.14]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="relative flex h-2.5 w-2.5 shrink-0">
                          {node.status === 'online' && (
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                          )}
                          <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${statusDotClass}`} />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-base font-semibold text-zinc-100">{node.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            <span className="capitalize">{node.role}</span>
                            {geo && (
                              <>
                                {' · '}
                                {flagFromCountryCode(geo.countryCode)} {geo.city || geo.country || 'Location inconnue'}
                              </>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex cursor-default">
                              <Badge {...versionBadge(node)} icon={<GitCommitHorizontal className="h-3 w-3" />} />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Agent : {node.agentVersion ?? 'jamais rapporté'}</p>
                            <p>Contrôleur : {node.controlVersion ?? '—'}</p>
                            {node.agentVersionAt && <p>Depuis : {formatDateTime(node.agentVersionAt)}</p>}
                          </TooltipContent>
                        </Tooltip>
                        <Badge
                          label={node.status}
                          type={node.status === 'online' ? 'success' : node.status === 'degraded' ? 'warning' : 'error'}
                        />
                      </div>
                    </div>

                    {labels.length > 0 && <NodeLabelBadges labels={labels} className="mt-3" />}

                    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <NodeMeter icon={Cpu} label="CPU" value={node.metrics.cpu} />
                      <NodeMeter icon={Gauge} label="RAM" value={node.metrics.ram} />
                      <NodeMeter
                        icon={HardDrive}
                        label="Stockage"
                        value={node.storage.usageRatio * 100}
                        suffix={`${node.storage.totalUsedGb} / ${node.storage.totalCapacityGb} GB`}
                      />
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/[0.06] pt-3 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1 font-mono">
                        <Globe2 className="h-3 w-3" />
                        {getExternalIp(node)}
                      </span>
                      <span className="flex items-center gap-1">
                        <ArrowDownToLine className="h-3 w-3" />
                        {formatMbps(node.metrics.networkRx)}
                      </span>
                      <span className="flex items-center gap-1">
                        <ArrowUpToLine className="h-3 w-3" />
                        {formatMbps(node.metrics.networkTx)}
                      </span>
                      <span className="truncate font-mono" title={node.id}>
                        {node.id}
                      </span>
                      <span className="ml-auto shrink-0">Vu {formatDateTime(node.lastSeenAt)}</span>
                    </div>

                    <div className="mt-3 flex items-center justify-end gap-1 border-t border-white/[0.06] pt-3">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setInspectingNode(node)}
                            className="h-8 w-8 text-muted-foreground hover:text-cyan-300"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Voir les détails du nœud</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSmartNode(node)}
                            className={`h-8 w-8 ${
                              smartIssue ? 'text-rose-400 hover:text-rose-300' : 'text-muted-foreground hover:text-cyan-300'
                            }`}
                          >
                            <Thermometer className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Santé SMART détaillée des disques</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => void triggerAgentUpdate(node)}
                            disabled={node.status !== 'online' || updatingNodeIds.has(node.id)}
                            className="h-8 w-8 text-muted-foreground hover:text-emerald-400 disabled:opacity-50"
                          >
                            <RefreshCcw className={`h-3.5 w-3.5 ${updatingNodeIds.has(node.id) ? 'animate-spin' : ''}`} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {node.status === 'online'
                            ? 'Mettre à jour l’agent (recompile + redémarrage service)'
                            : 'Agent hors ligne'}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => void toggleMute(node)}
                            className={`h-8 w-8 ${isMuted(node) ? 'text-amber-400 hover:text-amber-300' : 'text-muted-foreground hover:text-foreground'}`}
                          >
                            {isMuted(node) ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {isMuted(node)
                            ? `Alertes en silence jusqu’à ${formatDateTime(node.mutedUntil)}, cliquer pour réactiver`
                            : 'Mettre les alertes en silence 1h (maintenance)'}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditModal(node)}
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Modifier le nom et le rôle du nœud</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setNodeToDelete(node)}
                            className="h-8 w-8 text-muted-foreground hover:text-rose-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Supprimer définitivement ce nœud</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                );
              })}
            </div>
            )}

            {!nodesLoading && nodes.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Aucun nœud enregistré. Cliquez sur « Onboarder un nœud » pour commencer.
              </p>
            )}
          </CardContent>
        </Card>

          </TabsContent>
        </Tabs>

        <Dialog
          open={!!inspectingNode}
          onOpenChange={(open) => {
            if (!open) setInspectingNode(null);
          }}
        >
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Détails du nœud « {inspectingNode?.name} »</DialogTitle>
            </DialogHeader>
            {inspectingNode && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                  <div className="rounded-xl border border-white/[0.08] bg-zinc-950/50 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Node ID</p>
                    <p className="mt-1 break-all font-mono text-zinc-200">{inspectingNode.id}</p>
                  </div>
                  <div className="rounded-xl border border-white/[0.08] bg-zinc-950/50 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">IP externe</p>
                    <p className="mt-1 font-mono text-zinc-200">{getExternalIp(inspectingNode)}</p>
                  </div>
                  <div className="rounded-xl border border-white/[0.08] bg-zinc-950/50 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Endpoint overlay</p>
                    <p className="mt-1 break-all font-mono text-zinc-200">{inspectingNode.overlayEndpoint || '-'}</p>
                  </div>
                  <div className="rounded-xl border border-white/[0.08] bg-zinc-950/50 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Dernière activité</p>
                    <p className="mt-1 text-zinc-200">{formatDateTime(inspectingNode.lastSeenAt)}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-zinc-100">Disques</p>
                  <div className="space-y-2">
                    {inspectingNode.storage.disks.map((disk) => (
                      <div
                        key={disk.id}
                        className="rounded-xl border border-white/[0.08] bg-zinc-950/50 p-3 text-xs text-muted-foreground"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-mono text-zinc-200">{disk.mountPath}</p>
                          <p className="capitalize">{disk.type}</p>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span>
                            {disk.usedGb} / {disk.capacityGb} GB
                          </span>
                          <span>{Math.round(disk.usageRatio * 100)}%</span>
                        </div>
                        <Progress value={disk.usageRatio * 100} className="mt-2 h-1.5" />
                        {disk.smart && (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <Badge
                              label={
                                disk.smart.overall === 'healthy'
                                  ? 'SMART OK'
                                  : disk.smart.overall === 'warning'
                                    ? 'SMART dégradé'
                                    : disk.smart.overall === 'critical'
                                      ? 'SMART critique'
                                      : 'SMART inconnu'
                              }
                              type={
                                disk.smart.overall === 'healthy'
                                  ? 'success'
                                  : disk.smart.overall === 'warning'
                                    ? 'warning'
                                    : disk.smart.overall === 'critical'
                                      ? 'error'
                                      : 'info'
                              }
                            />
                            <span>{disk.smart.temperatureC}°C</span>
                            <span>{disk.smart.reallocatedSectors} secteurs réalloués</span>
                            <span>{disk.smart.pendingSectors} en attente</span>
                            <span>{Math.round(disk.smart.powerOnHours / 24)} j. d’activité</span>
                            <button
                              type="button"
                              onClick={() => toggleSmartHistory(inspectingNode.id, disk)}
                              className="ml-auto text-xs font-medium text-violet-300 hover:text-violet-200"
                            >
                              {expandedSmartDiskId === disk.id ? 'Masquer l’historique' : 'Historique SMART'}
                            </button>
                          </div>
                        )}
                        {expandedSmartDiskId === disk.id && (
                          <div className="mt-3 rounded-lg border border-white/[0.06] bg-zinc-950/60 p-2">
                            {smartHistoryLoading === disk.id ? (
                              <p className="py-6 text-center text-xs text-muted-foreground">Chargement…</p>
                            ) : (
                              <SmartTrendChart
                                data={(smartHistoryByDisk[disk.id] ?? []).map((point) => ({
                                  label: new Date(point.collectedAt).toLocaleString('fr-FR', {
                                    day: '2-digit',
                                    month: '2-digit',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  }),
                                  temperatureC: point.temperatureC,
                                  reallocatedSectors: point.reallocatedSectors,
                                  pendingSectors: point.pendingSectors,
                                }))}
                              />
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                    {inspectingNode.storage.disks.length === 0 && (
                      <p className="rounded-xl border border-dashed border-white/10 bg-zinc-950/40 px-3 py-4 text-center text-xs text-muted-foreground">
                        Aucun disque remonté par l’agent.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <Dialog
          open={!!smartNode}
          onOpenChange={(open) => {
            if (!open) setSmartNode(null);
          }}
        >
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Santé SMART « {smartNode?.name} »</DialogTitle>
            </DialogHeader>
            {smartNode && (
              <div className="space-y-3">
                {smartNode.storage.disks.length === 0 && (
                  <p className="rounded-xl border border-dashed border-white/10 bg-zinc-950/40 px-3 py-4 text-center text-xs text-muted-foreground">
                    Aucun disque remonté par l’agent.
                  </p>
                )}
                {smartNode.storage.disks.map((disk) => (
                  <div key={disk.id} className="rounded-xl border border-white/[0.08] bg-zinc-950/50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-mono text-sm text-zinc-200">{disk.mountPath}</p>
                      <p className="text-xs capitalize text-muted-foreground">{disk.type}</p>
                    </div>
                    {disk.smart ? (
                      <>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Badge
                            label={
                              disk.smart.overall === 'healthy'
                                ? 'SMART OK'
                                : disk.smart.overall === 'warning'
                                  ? 'SMART dégradé'
                                  : disk.smart.overall === 'critical'
                                    ? 'SMART critique'
                                    : 'SMART inconnu'
                            }
                            type={
                              disk.smart.overall === 'healthy'
                                ? 'success'
                                : disk.smart.overall === 'warning'
                                  ? 'warning'
                                  : disk.smart.overall === 'critical'
                                    ? 'error'
                                    : 'info'
                            }
                          />
                          <span>{disk.smart.temperatureC}°C</span>
                          <span>{disk.smart.reallocatedSectors} secteurs réalloués</span>
                          <span>{disk.smart.pendingSectors} en attente</span>
                          <span>{Math.round(disk.smart.powerOnHours / 24)} j. d’activité</span>
                          <span>Relevé {formatDateTime(disk.smart.collectedAt)}</span>
                        </div>
                        <div className="mt-3 rounded-lg border border-white/[0.06] bg-zinc-950/60 p-2">
                          {smartHistoryByDisk[disk.id] ? (
                            <SmartTrendChart
                              data={smartHistoryByDisk[disk.id].map((point) => ({
                                label: new Date(point.collectedAt).toLocaleString('fr-FR', {
                                  day: '2-digit',
                                  month: '2-digit',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                }),
                                temperatureC: point.temperatureC,
                                reallocatedSectors: point.reallocatedSectors,
                                pendingSectors: point.pendingSectors,
                              }))}
                            />
                          ) : (
                            <p className="py-6 text-center text-xs text-muted-foreground">Chargement…</p>
                          )}
                        </div>
                      </>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Pas de données SMART pour ce disque (agent hors ligne, disque réseau, ou smartctl indisponible).
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </DialogContent>
        </Dialog>

        <Dialog
          open={!!editNode}
          onOpenChange={(open) => {
            if (!open) setEditNode(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Modifier « {editNode?.name} »</DialogTitle>
            </DialogHeader>
            <form onSubmit={saveEditNode} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Nom du nœud</Label>
                <Input
                  id="edit-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-role">Rôle</Label>
                <Select value={editRole} onValueChange={setEditRole}>
                  <SelectTrigger id="edit-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="worker">Worker</SelectItem>
                    <SelectItem value="controller">Controller</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-labels">Labels (badges)</Label>
                <Input
                  id="edit-labels"
                  value={editLabels}
                  onChange={(e) => setEditLabels(e.target.value)}
                  placeholder="paris, production, critical"
                />
                <p className="text-xs text-muted-foreground">Sépare les labels par des virgules (max 6).</p>
              </div>
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setEditNode(null)}>
                  Annuler
                </Button>
                <Button type="submit" disabled={editLoading}>
                  {editLoading ? 'Sauvegarde…' : 'Sauvegarder'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog
          open={!!nodeToDelete}
          onOpenChange={(open) => {
            if (!open) setNodeToDelete(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Supprimer ce nœud ?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Le nœud « {nodeToDelete?.name} » sera supprimé définitivement. Cette action est irréversible.
            </p>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setNodeToDelete(null)}>
                Annuler
              </Button>
              <Button type="button" variant="destructive" onClick={() => nodeToDelete && void deleteNode(nodeToDelete)}>
                Supprimer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
  );
}
