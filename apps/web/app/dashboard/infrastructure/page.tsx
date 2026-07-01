'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Server, Plus, Pencil, Trash2, Info, Layers3 } from 'lucide-react';
import { api, NodeItem, PoolItem } from '../../../lib/api';
import { DashboardLayout } from '../../../components/DashboardLayout';
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

export default function InfrastructurePage() {
  const router = useRouter();
  const token = useMemo(() => (typeof window !== 'undefined' ? localStorage.getItem('tarmac_token') : null), []);

  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [pools, setPools] = useState<PoolItem[]>([]);

  const [poolDialogOpen, setPoolDialogOpen] = useState(false);
  const [poolName, setPoolName] = useState('');
  const [poolStrategy, setPoolStrategy] = useState('mirror');

  const [editNode, setEditNode] = useState<NodeItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editLoading, setEditLoading] = useState(false);

  const load = async () => {
    if (!token) return;
    try {
      const [n, p] = await Promise.all([
        api.nodes.list(token),
        api.pools.list(token),
      ]);
      setNodes(n);
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

  const deleteNode = async (node: NodeItem) => {
    if (!token) return;
    if (!confirm(`Supprimer le nœud « ${node.name} » ? Cette action est irréversible.`)) return;
    await api.nodes.delete(token, node.id);
    await load();
  };

  const openEditModal = (node: NodeItem) => {
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

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Infrastructure</h1>
            <p className="text-sm text-muted-foreground">Gestion des nœuds et des pools de stockage.</p>
          </div>
          <NodeOnboardingModal onCreated={load} />
        </div>

        {/* Nodes info callout */}
        <div className="flex items-start gap-3 rounded-xl border border-blue-500/20 bg-blue-500/[0.07] px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
          <p className="text-sm text-blue-300/80">
            <strong className="text-blue-200">Nœuds :</strong> Serveurs exécutant Tarmac.
            Un <strong className="text-blue-200">worker</strong> stocke les données, un <strong className="text-blue-200">controller</strong> gère le cluster.
            Utilisez «&nbsp;Onboarder un nœud&nbsp;» pour enregistrer un nouveau serveur et récupérer la commande de démarrage de l'agent.
          </p>
        </div>

        {/* Nodes Section */}
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
                  <TableHead>Nom</TableHead>
                  <TableHead>Rôle</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Vu pour la dernière fois</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nodes.map((node) => (
                  <TableRow key={node.id}>
                    <TableCell className="font-medium">{node.name}</TableCell>
                    <TableCell className="text-muted-foreground capitalize">{node.role}</TableCell>
                    <TableCell>
                      <Badge
                        label={node.status}
                        type={node.status === 'online' ? 'success' : 'error'}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {node.lastSeenAt
                        ? new Date(node.lastSeenAt).toLocaleString('fr-FR')
                        : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
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
                              onClick={() => deleteNode(node)}
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
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      Aucun nœud enregistré. Cliquez sur «&nbsp;Onboarder un nœud&nbsp;» pour commencer.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Edit Node Dialog */}
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

        {/* Pools info callout */}
        <div className="flex items-start gap-3 rounded-xl border border-blue-500/20 bg-blue-500/[0.07] px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
          <p className="text-sm text-blue-300/80">
            <strong className="text-blue-200">Pools :</strong> Groupes de disques fonctionnant ensemble selon une stratégie.
            <strong className="text-blue-200"> Mirror</strong> = copie redondante,
            <strong className="text-blue-200"> RAID</strong> = distribution,
            <strong className="text-blue-200"> Single</strong> = stockage simple sans redondance.
          </p>
        </div>

        {/* Pools Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers3 className="h-5 w-5 text-violet-400" />
                <CardTitle>Pools de stockage</CardTitle>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" onClick={() => setPoolDialogOpen(true)}>
                    <Plus className="h-4 w-4" />
                    Nouveau pool
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Créer un nouveau pool de disques</TooltipContent>
              </Tooltip>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {pools.map((pool) => (
                <div key={pool.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.04]">
                  <div className="mb-3 flex items-start justify-between">
                    <h4 className="font-semibold text-foreground">{pool.name}</h4>
                    <Badge label={pool.status} type="info" />
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Stratégie</span>
                      <span className="font-medium text-foreground/90 capitalize">{pool.strategy}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Membres</span>
                      <span className="font-medium text-foreground/90">{pool.members.length}</span>
                    </div>
                  </div>
                </div>
              ))}
              {pools.length === 0 && (
                <p className="col-span-full py-6 text-center text-sm text-muted-foreground">
                  Aucun pool. Cliquez sur «&nbsp;Nouveau pool&nbsp;» pour en créer un.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Create Pool Dialog */}
        <Dialog open={poolDialogOpen} onOpenChange={setPoolDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Créer un pool de stockage</DialogTitle>
            </DialogHeader>
            <form onSubmit={createPool} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pool-name">Nom du pool</Label>
                <Input
                  id="pool-name"
                  placeholder="ex: pool-data"
                  value={poolName}
                  onChange={(e) => setPoolName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pool-strategy">Stratégie</Label>
                <Select value={poolStrategy} onValueChange={setPoolStrategy}>
                  <SelectTrigger id="pool-strategy">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mirror">Mirror (Copie redondante)</SelectItem>
                    <SelectItem value="raid">RAID (Distribution)</SelectItem>
                    <SelectItem value="single">Single (Stockage simple)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setPoolDialogOpen(false)}>
                  Annuler
                </Button>
                <Button type="submit">Créer pool</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
