'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Plus, Play, Info } from 'lucide-react';
import { api, SyncJobItem, NodeItem } from '../../../lib/api';
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

export default function ReplicationPage() {
  const router = useRouter();
  const token = useMemo(() => (typeof window !== 'undefined' ? localStorage.getItem('tarmac_token') : null), []);

  const [syncJobs, setSyncJobs] = useState<SyncJobItem[]>([]);
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  const [syncJobName, setSyncJobName] = useState('');
  const [syncJobSource, setSyncJobSource] = useState('');
  const [syncJobTarget, setSyncJobTarget] = useState('');
  const [syncJobSchedule, setSyncJobSchedule] = useState('manual');
  const [syncJobNodeId, setSyncJobNodeId] = useState('');

  const load = async () => {
    if (!token) return;
    try {
      const [sj, n] = await Promise.all([
        api.syncJobs.list(token),
        api.nodes.list(token),
      ]);
      setSyncJobs(sj);
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

  const createSyncJob = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    await api.syncJobs.create(token, {
      name: syncJobName,
      sourcePath: syncJobSource,
      targetPath: syncJobTarget,
      schedule: syncJobSchedule,
      nodeId: syncJobNodeId || undefined,
    });
    setSyncJobName('');
    setSyncJobSource('');
    setSyncJobTarget('');
    setSyncJobSchedule('manual');
    setSyncJobNodeId('');
    await load();
    setDialogOpen(false);
  };

  const runSync = async (jobId: string) => {
    if (!token) return;
    await api.syncJobs.run(token, jobId);
    await load();
  };

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Réplication</h1>
            <p className="text-sm text-muted-foreground">Synchronisation de données entre serveurs.</p>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button onClick={() => setDialogOpen(true)}>
                <Plus className="h-4 w-4" />
                Nouveau travail
              </Button>
            </TooltipTrigger>
            <TooltipContent>Créer un nouveau travail de synchronisation</TooltipContent>
          </Tooltip>
        </div>

        {/* Info callout */}
        <div className="flex items-start gap-3 rounded-xl border border-blue-500/20 bg-blue-500/[0.07] px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
          <p className="text-sm text-blue-300/80">
            Un <strong className="text-blue-200">travail de sync</strong> copie automatiquement les données d'un dossier source vers un dossier destination.
            Idéal pour les <strong className="text-blue-200">sauvegardes automatiques</strong> et la réplication entre nœuds.
            Utilisez le bouton <strong className="text-blue-200">Exécuter</strong> pour lancer une synchronisation manuelle immédiate.
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-violet-400" />
              <CardTitle>Travaux de synchronisation</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {syncJobs.map((job) => (
              <div
                key={job.id}
                className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.04]"
              >
                <div className="mb-3 flex items-start justify-between">
                  <div>
                    <h4 className="font-semibold text-foreground">{job.name}</h4>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {job.sourcePath} → {job.targetPath}
                    </p>
                  </div>
                  <Badge label={job.status} type="info" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground capitalize">
                    Planification : {job.schedule}
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => runSync(job.id)}
                      >
                        <Play className="h-3.5 w-3.5" />
                        Exécuter maintenant
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Lancer une synchronisation immédiate de ce travail</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            ))}
            {syncJobs.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Aucun travail. Cliquez sur «&nbsp;Nouveau travail&nbsp;» pour en créer un.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Create Sync Job Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Créer un travail de sync</DialogTitle>
            </DialogHeader>
            <form onSubmit={createSyncJob} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="job-name">Nom du travail</Label>
                <Input
                  id="job-name"
                  placeholder="ex: backup-daily"
                  value={syncJobName}
                  onChange={(e) => setSyncJobName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="job-source">Dossier source</Label>
                <Input
                  id="job-source"
                  placeholder="ex: /data/important"
                  value={syncJobSource}
                  onChange={(e) => setSyncJobSource(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="job-target">Dossier destination</Label>
                <Input
                  id="job-target"
                  placeholder="ex: /backup/important"
                  value={syncJobTarget}
                  onChange={(e) => setSyncJobTarget(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="job-schedule">Planification</Label>
                <Select value={syncJobSchedule} onValueChange={setSyncJobSchedule}>
                  <SelectTrigger id="job-schedule">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manuel</SelectItem>
                    <SelectItem value="hourly">Toutes les heures</SelectItem>
                    <SelectItem value="daily">Tous les jours</SelectItem>
                    <SelectItem value="weekly">Toutes les semaines</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="job-node">Nœud (optionnel)</Label>
                <Select value={syncJobNodeId} onValueChange={setSyncJobNodeId}>
                  <SelectTrigger id="job-node">
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
                <Button type="button" variant="secondary" onClick={() => setDialogOpen(false)}>
                  Annuler
                </Button>
                <Button type="submit">Créer travail</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
