'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Server,
  Plus,
  Pencil,
  Trash2,
  Info,
  Layers3,
  Cpu,
  ArrowDownToLine,
  ArrowUpToLine,
  HardDrive,
  RefreshCcw,
} from 'lucide-react';
import { api, NodeActivityItem, NodeMetricSample, PoolItem } from '../../../lib/api';
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

const formatBytesPerSecond = (value: number) => {
  const mbps = (value * 8) / 1_000_000; // Convert B/s to Mbps
  return `${mbps.toFixed(2)} Mbps`;
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

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Infrastructure</h1>
            <p className="text-sm text-muted-foreground">Gestion des nœuds, des pools et de leur activité.</p>
          </div>
          <NodeOnboardingModal onCreated={load} />
        </div>

        <div className="flex items-start gap-3 rounded-xl border border-blue-500/20 bg-blue-500/[0.07] px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
          <p className="text-sm text-blue-300/80">
            <strong className="text-blue-200">Activité serveur :</strong> CPU, RAM, réseau et occupation disque sont
            agrégés à partir du dernier heartbeat et du dernier état de stockage reçu.
          </p>
        </div>
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

        <Card>
          <CardHeader>
            <CardTitle>Cartes de performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {[...nodes].sort((left, right) => right.metrics.cpu - left.metrics.cpu).slice(0, 6).map((node) => (
                <ServerTrendCard key={node.id} node={node} samples={samplesByNode[node.id] ?? []} />
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Server className="h-5 w-5 text-violet-400" />
              <CardTitle>Nœuds (Serveurs)</CardTitle>
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
                    <TableCell className="font-mono text-xs text-muted-foreground break-all max-w-xs">{node.id}</TableCell>
                    <TableCell className="font-medium">{node.name}</TableCell>
                    <TableCell className="text-muted-foreground capitalize">{node.role}</TableCell>
                    <TableCell>
                      <Badge label={node.status} type={node.status === 'online' ? 'success' : 'error'} />
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
                        {formatBytesPerSecond(node.metrics.networkRx)}
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <ArrowUpToLine className="h-3.5 w-3.5" />
                        {formatBytesPerSecond(node.metrics.networkTx)}
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
                    <TableCell className="text-muted-foreground text-xs">
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
                              <RefreshCcw
                                className={`h-3.5 w-3.5 ${updatingNodeId === node.id ? 'animate-spin' : ''}`}
                              />
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
                      Aucun nœud enregistré. Cliquez sur «&nbsp;Onboarder un nœud&nbsp;» pour commencer.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Dialog open={!!editNode} onOpenChange={(open) => { if (!open) setEditNode(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Modifier «&nbsp;{editNode?.name}&nbsp;»</DialogTitle>
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

        <Dialog open={!!nodeToDelete} onOpenChange={(open) => { if (!open) setNodeToDelete(null); }}>
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
              <Button
                type="button"
                variant="destructive"
                onClick={() => nodeToDelete && void deleteNode(nodeToDelete)}
              >
                Supprimer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="flex items-start gap-3 rounded-xl border border-blue-500/20 bg-blue-500/[0.07] px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
          <p className="text-sm text-blue-300/80">
            <strong className="text-blue-200">Pools :</strong> Groupes de disques fonctionnant ensemble selon une stratégie.
            <strong className="text-blue-200"> Mirror</strong> = copie redondante,
            <strong className="text-blue-200"> RAID</strong> = distribution,
            <strong className="text-blue-200"> Single</strong> = stockage simple sans redondance.
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers3 className="h-5 w-5 text-violet-400" />
                <CardTitle>Pools</CardTitle>
              </div>
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
          </CardHeader>
          <CardContent className="space-y-3">
            {pools.map((pool) => (
              <div key={pool.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-foreground">{pool.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{pool.strategy}</p>
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
