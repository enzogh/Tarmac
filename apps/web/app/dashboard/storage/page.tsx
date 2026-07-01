'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Database, HardDrive, Plus, Info } from 'lucide-react';
import { api, ShareItem, MountItem, NodeItem } from '../../../lib/api';
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

export default function StoragePage() {
  const router = useRouter();
  const token = useMemo(() => (typeof window !== 'undefined' ? localStorage.getItem('tarmac_token') : null), []);

  const [shares, setShares] = useState<ShareItem[]>([]);
  const [mounts, setMounts] = useState<MountItem[]>([]);
  const [nodes, setNodes] = useState<NodeItem[]>([]);

  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [mountDialogOpen, setMountDialogOpen] = useState(false);

  const [shareName, setShareName] = useState('');
  const [sharePath, setSharePath] = useState('');
  const [shareNodeId, setShareNodeId] = useState('');

  const [mountName, setMountName] = useState('');
  const [mountSource, setMountSource] = useState('');
  const [mountTarget, setMountTarget] = useState('');
  const [mountNodeId, setMountNodeId] = useState('');

  const load = async () => {
    if (!token) return;
    try {
      const [s, m, n] = await Promise.all([
        api.shares.list(token),
        api.mounts.list(token),
        api.nodes.list(token),
      ]);
      setShares(s);
      setMounts(m);
      setNodes(n);
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

  const createShare = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    await api.shares.create(token, {
      name: shareName,
      path: sharePath,
      nodeId: shareNodeId || undefined,
    });
    setShareName('');
    setSharePath('');
    setShareNodeId('');
    await load();
    setShareDialogOpen(false);
  };

  const createMount = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    await api.mounts.create(token, {
      name: mountName,
      sourcePath: mountSource,
      targetPath: mountTarget,
      nodeId: mountNodeId || undefined,
    });
    setMountName('');
    setMountSource('');
    setMountTarget('');
    setMountNodeId('');
    await load();
    setMountDialogOpen(false);
  };

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Stockage</h1>
          <p className="text-sm text-muted-foreground">Gestion des partages réseau et des montages.</p>
        </div>

        {/* Shares info callout */}
        <div className="flex items-start gap-3 rounded-xl border border-blue-500/20 bg-blue-500/[0.07] px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
          <p className="text-sm text-blue-300/80">
            Un <strong className="text-blue-200">partage</strong> est un dossier accessible via le réseau (NFS pour Linux, SMB pour Windows).
            Un <strong className="text-blue-200">montage</strong> associe un partage à un chemin local sur un nœud — comme brancher une clé USB.
          </p>
        </div>

        {/* Shares Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-violet-400" />
                <CardTitle>Partages NFS / SMB</CardTitle>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" onClick={() => setShareDialogOpen(true)}>
                    <Plus className="h-4 w-4" />
                    Nouveau partage
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Créer un nouveau partage réseau (NFS/SMB)</TooltipContent>
              </Tooltip>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {shares.map((share) => (
                <div key={share.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.04]">
                  <div className="mb-3 flex items-start justify-between">
                    <h4 className="font-semibold text-foreground">{share.name}</h4>
                    <Badge label={share.status} type="info" />
                  </div>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Chemin :</span>
                      <p className="mt-0.5 font-mono text-xs text-foreground/80 break-all">{share.path}</p>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Nœud</span>
                      <span className="text-foreground/90">{share.nodeId ?? 'Auto'}</span>
                    </div>
                  </div>
                </div>
              ))}
              {shares.length === 0 && (
                <p className="col-span-full py-6 text-center text-sm text-muted-foreground">
                  Aucun partage. Cliquez sur «&nbsp;Nouveau partage&nbsp;» pour en créer un.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Mounts Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HardDrive className="h-5 w-5 text-violet-400" />
                <CardTitle>Montages</CardTitle>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" onClick={() => setMountDialogOpen(true)}>
                    <Plus className="h-4 w-4" />
                    Nouveau montage
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Monter un partage sur un chemin local d'un nœud</TooltipContent>
              </Tooltip>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {mounts.map((mount) => (
              <div key={mount.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.04]">
                <div className="mb-2 flex items-start justify-between">
                  <h4 className="font-semibold text-foreground">{mount.name}</h4>
                  <Badge label={mount.status} type="info" />
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                  <span>{mount.sourcePath}</span>
                  <span className="text-zinc-600">→</span>
                  <span>{mount.targetPath}</span>
                </div>
              </div>
            ))}
            {mounts.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Aucun montage. Cliquez sur «&nbsp;Nouveau montage&nbsp;» pour en créer un.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Share Dialog */}
        <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Créer un partage réseau</DialogTitle>
            </DialogHeader>
            <form onSubmit={createShare} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="share-name">Nom du partage</Label>
                <Input
                  id="share-name"
                  placeholder="ex: backup"
                  value={shareName}
                  onChange={(e) => setShareName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="share-path">Chemin du dossier</Label>
                <Input
                  id="share-path"
                  placeholder="ex: /data/backup"
                  value={sharePath}
                  onChange={(e) => setSharePath(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="share-node">Nœud (optionnel)</Label>
                <Select value={shareNodeId} onValueChange={setShareNodeId}>
                  <SelectTrigger id="share-node">
                    <SelectValue placeholder="Automatique" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Automatique</SelectItem>
                    {nodes.map((n) => (
                      <SelectItem key={n.id} value={n.id}>{n.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setShareDialogOpen(false)}>
                  Annuler
                </Button>
                <Button type="submit">Créer partage</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Mount Dialog */}
        <Dialog open={mountDialogOpen} onOpenChange={setMountDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Créer un montage</DialogTitle>
            </DialogHeader>
            <form onSubmit={createMount} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="mount-name">Nom du montage</Label>
                <Input
                  id="mount-name"
                  placeholder="ex: data-mount"
                  value={mountName}
                  onChange={(e) => setMountName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mount-source">Source (partage réseau)</Label>
                <Input
                  id="mount-source"
                  placeholder="ex: //server/share"
                  value={mountSource}
                  onChange={(e) => setMountSource(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mount-target">Destination (chemin local)</Label>
                <Input
                  id="mount-target"
                  placeholder="ex: /mnt/data"
                  value={mountTarget}
                  onChange={(e) => setMountTarget(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mount-node">Nœud (optionnel)</Label>
                <Select value={mountNodeId} onValueChange={setMountNodeId}>
                  <SelectTrigger id="mount-node">
                    <SelectValue placeholder="Automatique" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Automatique</SelectItem>
                    {nodes.map((n) => (
                      <SelectItem key={n.id} value={n.id}>{n.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => setMountDialogOpen(false)}>
                  Annuler
                </Button>
                <Button type="submit">Créer montage</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
