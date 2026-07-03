'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Cpu,
  FolderSearch,
  Gauge,
  HardDrive,
  Info,
  Layers3,
  Network,
  Pencil,
  Plus,
  RefreshCcw,
  Server,
  Trash2,
} from 'lucide-react';
import { api, DirectoryScanEntry, NodeActivityItem, NodeMetricSample, PoolItem } from '../../../lib/api';
import { DashboardLayout } from '../../../components/DashboardLayout';
import { ServerTrendCard } from '../../../components/ServerTrendCard';
import { Badge } from '../../../components/ui';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../../components/ui/dialog';
import { NodeOnboardingModal } from '../../../components/NodeOnboardingModal';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { Progress } from '../../../components/ui/progress';
import { DirectoryBrowser } from '../../../components/ui/directory-browser';

const formatMbps = (value: number) => `${((value * 8) / 1_000_000).toFixed(2)} MBPS`;

const formatBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const base = Math.log(value) / Math.log(1024);
  const index = Math.min(units.length - 1, Math.max(0, Math.floor(base)));
  const scaled = value / 1024 ** index;
  return `${scaled >= 10 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[index]}`;
};

export default function InfrastructurePage() {
  const router = useRouter();
  const token = useMemo(() => (typeof window !== 'undefined' ? localStorage.getItem('tarmac_token') : null), []);

  const [nodes, setNodes] = useState<NodeActivityItem[]>([]);
  const [samplesByNode, setSamplesByNode] = useState<Record<string, NodeMetricSample[]>>({});
  const [pools, setPools] = useState<PoolItem[]>([]);

  const [poolDialogOpen, setPoolDialogOpen] = useState(false);
  const [poolName, setPoolName] = useState('');
  const [poolStrategy, setPoolStrategy] = useState('mirror');

  const [editNode, setEditNode] = useState<NodeActivityItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [nodeToDelete, setNodeToDelete] = useState<NodeActivityItem | null>(null);
  const [updatingNodeId, setUpdatingNodeId] = useState<string | null>(null);
  const [updateNotice, setUpdateNotice] = useState<{ type: 'error' | 'success'; message: string } | null>(null);

  const [selectedExplorerNodeId, setSelectedExplorerNodeId] = useState<string>('');
  const [browsePath, setBrowsePath] = useState('/');
  const [selectedPath, setSelectedPath] = useState('/');
  const [directories, setDirectories] = useState<string[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanResults, setScanResults] = useState<DirectoryScanEntry[]>([]);
  const [scanTruncated, setScanTruncated] = useState(false);

  const load = async () => {
    if (!token) return;
    try {
      const [n, p] = await Promise.all([api.nodes.activity(token), api.pools.list(token)]);
      const topNodes = [...n].sort((left, right) => right.metrics.cpu - left.metrics.cpu).slice(0, 6);
      const histories = await Promise.all(
        topNodes.map(async (node) => [node.id, await api.nodes.metrics(token, node.id, '6h')] as const),
      );
      setNodes(n);
      setSamplesByNode(Object.fromEntries(histories));
      setPools(p);
    } catch {
      localStorage.removeItem('tarmac_token');
      router.push('/login');
    }
  };

  const loadNodeDirectories = async (nodeId: string, basePath: string) => {
    if (!token || !nodeId) return;
    setDirectoryLoading(true);
    try {
      const payload = await api.migrations.listDirectories(token, nodeId, basePath || '/');
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
    if (!token || !selectedExplorerNodeId) return;
    setScanLoading(true);
    try {
      const payload = await api.migrations.scanDirectories(token, selectedExplorerNodeId, selectedPath || browsePath, 20);
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
    if (!token) {
      router.push('/login');
      return;
    }
    void load();
    const id = setInterval(() => {
      void load();
    }, 5000);
    return () => clearInterval(id);
  }, [token]);

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

  const createPool = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    await api.pools.create(token, { name: poolName, strategy: poolStrategy });
    setPoolName('');
    setPoolStrategy('mirror');
    await load();
    setPoolDialogOpen(false);
  };

  const deleteNode = async (node: NodeActivityItem) => {
    if (!token) return;
    await api.nodes.delete(token, node.id);
    await load();
    setNodeToDelete(null);
  };

  const openEditModal = (node: NodeActivityItem) => {
    setEditNode(node);
    setEditName(node.name);
    setEditRole(node.role);
  };

  const saveEditNode = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !editNode) return;
    setEditLoading(true);
    try {
      await api.nodes.update(token, editNode.id, { name: editName, role: editRole });
      await load();
      setEditNode(null);
    } finally {
      setEditLoading(false);
    }
  };

  const triggerAgentUpdate = async (node: NodeActivityItem) => {
    if (!token) return;
    setUpdatingNodeId(node.id);
    try {
      const result = await api.agents.update(token, node.id);
      if (!result.queued) {
        setUpdateNotice({
          type: 'error',
          message: `Impossible de mettre à jour ${node.name}: agent hors ligne.`,
        });
        return;
      }
      setUpdateNotice({
        type: 'success',
        message: `Mise à jour de ${node.name} lancée (recompile + restart du service).`,
      });
    } catch {
      setUpdateNotice({
        type: 'error',
        message: `Échec du lancement de la mise à jour pour ${node.name}.`,
      });
    } finally {
      setUpdatingNodeId(null);
    }
  };

  const onlineNodes = nodes.filter((node) => node.status === 'online').length;
  const degradedNodes = nodes.filter((node) => node.status === 'degraded').length;
  const avgCpu = nodes.length ? nodes.reduce((acc, node) => acc + node.metrics.cpu, 0) / nodes.length : 0;
  const avgRam = nodes.length ? nodes.reduce((acc, node) => acc + node.metrics.ram, 0) / nodes.length : 0;

  const selectedExplorerNode = nodes.find((node) => node.id === selectedExplorerNodeId) ?? null;
  const scanMax = scanResults[0]?.sizeBytes ?? 1;

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <section className="relative overflow-hidden rounded-3xl border border-violet-500/20 bg-radial-premium p-6 shadow-panel lg:p-8">
          <div className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-violet-500/20 blur-3xl" />
          <div className="relative space-y-4">
            <div className="space-y-1">
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">Infrastructure</h1>
              <p className="max-w-3xl text-sm text-zinc-300">
                Pilotage des nœuds, monitoring temps réel, scan volumétrique des dossiers et opérations agent sans CLI.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Card className="border-white/10 bg-zinc-950/55">
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Nœuds online</p>
                    <p className="text-2xl font-semibold text-emerald-300">{onlineNodes}</p>
                  </div>
                  <Server className="h-5 w-5 text-emerald-300" />
                </CardContent>
              </Card>
              <Card className="border-white/10 bg-zinc-950/55">
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Nœuds dégradés</p>
                    <p className="text-2xl font-semibold text-amber-300">{degradedNodes}</p>
                  </div>
                  <Gauge className="h-5 w-5 text-amber-300" />
                </CardContent>
              </Card>
              <Card className="border-white/10 bg-zinc-950/55">
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">CPU moyen</p>
                    <p className="text-2xl font-semibold text-violet-200">{Math.round(avgCpu)}%</p>
                  </div>
                  <Cpu className="h-5 w-5 text-violet-300" />
                </CardContent>
              </Card>
              <Card className="border-white/10 bg-zinc-950/55">
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">RAM moyenne</p>
                    <p className="text-2xl font-semibold text-cyan-200">{Math.round(avgRam)}%</p>
                  </div>
                  <HardDrive className="h-5 w-5 text-cyan-300" />
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <Card className="border-blue-500/20 bg-blue-500/[0.07]">
          <CardContent className="flex items-start gap-3 p-4">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-300" />
            <div className="space-y-1 text-sm text-blue-100/90">
              <p>
                <strong className="text-blue-100">Documentation rapide :</strong> utilisez le navigateur de dossiers pour
                explorer un nœud puis lancez un scan volumétrique afin d’identifier rapidement les répertoires les plus lourds.
              </p>
              <p className="text-xs text-blue-200/80">
                Le scan est optimisé pour rester réactif (top dossiers, fenêtre de temps courte) et ne bloque pas la page.
              </p>
            </div>
          </CardContent>
        </Card>

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

        <Card className="border-white/[0.08] bg-zinc-900/65">
          <CardHeader>
            <CardTitle>Cartes de performance (CPU/RAM en %)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {[...nodes].sort((left, right) => right.metrics.cpu - left.metrics.cpu).slice(0, 6).map((node) => (
                <ServerTrendCard key={node.id} node={node} samples={samplesByNode[node.id] ?? []} />
              ))}
              {nodes.length === 0 && (
                <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
                  Aucun nœud détecté pour le moment.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

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

        <Card className="border-white/[0.08] bg-zinc-900/65">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Server className="h-5 w-5 text-violet-400" />
              <CardTitle>Nœuds (serveurs)</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Node ID</TableHead>
                  <TableHead>Nom</TableHead>
                  <TableHead>Rôle</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>CPU</TableHead>
                  <TableHead>RAM</TableHead>
                  <TableHead>Réseau</TableHead>
                  <TableHead>Disques</TableHead>
                  <TableHead>Vu pour la dernière fois</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nodes.map((node) => (
                  <TableRow key={node.id}>
                    <TableCell className="max-w-xs break-all font-mono text-xs text-muted-foreground">{node.id}</TableCell>
                    <TableCell className="font-medium">{node.name}</TableCell>
                    <TableCell className="capitalize text-muted-foreground">{node.role}</TableCell>
                    <TableCell>
                      <Badge
                        label={node.status}
                        type={node.status === 'online' ? 'success' : node.status === 'degraded' ? 'warning' : 'error'}
                      />
                    </TableCell>
                    <TableCell className="min-w-36">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Cpu className="h-3.5 w-3.5" />
                          {Math.round(node.metrics.cpu)}%
                        </div>
                        <Progress value={node.metrics.cpu} className="h-1.5" />
                      </div>
                    </TableCell>
                    <TableCell className="min-w-36">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <HardDrive className="h-3.5 w-3.5" />
                          {Math.round(node.metrics.ram)}%
                        </div>
                        <Progress value={node.metrics.ram} className="h-1.5" />
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <ArrowDownToLine className="h-3.5 w-3.5" />
                        {formatMbps(node.metrics.networkRx)}
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <ArrowUpToLine className="h-3.5 w-3.5" />
                        {formatMbps(node.metrics.networkTx)}
                      </div>
                    </TableCell>
                    <TableCell className="min-w-44">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span>
                            {node.storage.totalUsedGb} GB / {node.storage.totalCapacityGb} GB
                          </span>
                          <span>{Math.round(node.storage.usageRatio * 100)}%</span>
                        </div>
                        <Progress value={node.storage.usageRatio * 100} className="h-1.5" />
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {node.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString('fr-FR') : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => void triggerAgentUpdate(node)}
                              disabled={node.status !== 'online' || updatingNodeId === node.id}
                              className="h-8 w-8 text-muted-foreground hover:text-emerald-400 disabled:opacity-50"
                            >
                              <RefreshCcw className={`h-3.5 w-3.5 ${updatingNodeId === node.id ? 'animate-spin' : ''}`} />
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
                    </TableCell>
                  </TableRow>
                ))}
                {nodes.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">
                      Aucun nœud enregistré. Cliquez sur « Onboarder un nœud » pour commencer.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-blue-500/20 bg-blue-500/[0.07]">
          <CardContent className="flex items-start gap-3 p-4">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
            <p className="text-sm text-blue-300/80">
              <strong className="text-blue-200">Pools :</strong> groupes de disques avec stratégie.
              <strong className="text-blue-200"> Mirror</strong> = copie redondante,
              <strong className="text-blue-200"> RAID</strong> = distribution,
              <strong className="text-blue-200"> Single</strong> = stockage simple.
            </p>
          </CardContent>
        </Card>

        <Card className="border-white/[0.08] bg-zinc-900/65">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers3 className="h-5 w-5 text-violet-400" />
                <CardTitle>Pools</CardTitle>
              </div>
              <div className="flex items-center gap-2">
                <NodeOnboardingModal onCreated={load} />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" onClick={() => setPoolDialogOpen(true)}>
                      <Plus className="h-4 w-4" />
                      Nouveau pool
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Créer un pool de stockage</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {pools.map((pool) => (
              <div key={pool.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-foreground">{pool.name}</p>
                    <p className="text-xs capitalize text-muted-foreground">{pool.strategy}</p>
                  </div>
                  <Badge label={pool.status} type={pool.status === 'active' ? 'success' : 'warning'} />
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  {pool.members.map((member) => (
                    <div key={member.nodeId} className="flex items-center justify-between">
                      <span>{member.nodeId}</span>
                      <span className="capitalize">
                        {member.role} · {member.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {pools.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">Aucun pool</p>}
          </CardContent>
        </Card>

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

        <Dialog open={poolDialogOpen} onOpenChange={setPoolDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Créer un pool</DialogTitle>
            </DialogHeader>
            <form onSubmit={createPool} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pool-name">Nom du pool</Label>
                <Input id="pool-name" value={poolName} onChange={(e) => setPoolName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pool-strategy">Stratégie</Label>
                <Select value={poolStrategy} onValueChange={setPoolStrategy}>
                  <SelectTrigger id="pool-strategy">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mirror">Mirror</SelectItem>
                    <SelectItem value="raid">RAID</SelectItem>
                    <SelectItem value="single">Single</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setPoolDialogOpen(false)}>
                  Annuler
                </Button>
                <Button type="submit">Créer</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
