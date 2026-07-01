'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRightLeft, Plus, PlayCircle, Loader2, CheckCircle2, Info } from 'lucide-react';
import { api, MigrationItem, NodeItem } from '../../../lib/api';
import { DashboardLayout } from '../../../components/DashboardLayout';
import { Badge } from '../../../components/ui';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../components/ui/tooltip';
import { Progress } from '../../../components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../../components/ui/dialog';

export default function MigrationsPage() {
  const router = useRouter();
  const token = useMemo(() => (typeof window !== 'undefined' ? localStorage.getItem('tarmac_token') : null), []);

  const [migrations, setMigrations] = useState<MigrationItem[]>([]);
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  const [migrationName, setMigrationName] = useState('');
  const [migrationSourceNodeId, setMigrationSourceNodeId] = useState('');
  const [migrationTargetNodeId, setMigrationTargetNodeId] = useState('');

  const load = async () => {
    if (!token) return;
    try {
      const [mg, n] = await Promise.all([
        api.migrations.list(token),
        api.nodes.list(token),
      ]);
      setMigrations(mg);
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

  const createMigration = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    await api.migrations.create(token, {
      name: migrationName,
      sourceNodeId: migrationSourceNodeId || undefined,
      targetNodeId: migrationTargetNodeId || undefined,
    });
    setMigrationName('');
    setMigrationSourceNodeId('');
    setMigrationTargetNodeId('');
    await load();
    setDialogOpen(false);
  };

  const startMigration = async (migrationId: string) => {
    if (!token) return;
    await api.migrations.start(token, migrationId);
    await load();
  };

  const getStatusColor = (status: string): 'success' | 'warning' | 'error' | 'info' => {
    switch (status) {
      case 'completed': return 'success';
      case 'running': return 'info';
      case 'failed': return 'error';
      default: return 'info';
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Migrations</h1>
            <p className="text-sm text-muted-foreground">Déplacement de données entre nœuds.</p>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button onClick={() => setDialogOpen(true)}>
                <Plus className="h-4 w-4" />
                Nouvelle migration
              </Button>
            </TooltipTrigger>
            <TooltipContent>Créer une nouvelle tâche de migration de données</TooltipContent>
          </Tooltip>
        </div>

        {/* Info callout */}
        <div className="flex items-start gap-3 rounded-xl border border-blue-500/20 bg-blue-500/[0.07] px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
          <p className="text-sm text-blue-300/80">
            Une <strong className="text-blue-200">migration</strong> déplace vos données d'un serveur source vers un serveur destination.
            Utile lors d'opérations de maintenance, de rééquilibrage de charge, ou de décommissionnement d'un nœud.
            Après création, cliquez sur <strong className="text-blue-200">Démarrer</strong> pour lancer le transfert.
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-violet-400" />
              <CardTitle>Migrations de données</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {migrations.map((migration) => (
              <div key={migration.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <div className="mb-4 flex items-start justify-between">
                  <div className="flex-1">
                    <h4 className="font-semibold text-foreground">{migration.name}</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Création : {new Date(migration.createdAt).toLocaleString('fr-FR')}
                    </p>
                  </div>
                  <Badge label={migration.status} type={getStatusColor(migration.status)} />
                </div>

                <div className="mb-4">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Progression</span>
                    <span className="text-xs text-muted-foreground">{migration.progress}%</span>
                  </div>
                  <Progress value={migration.progress} className="h-2" />
                </div>

                {migration.status === 'pending' && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        className="w-full"
                        onClick={() => startMigration(migration.id)}
                      >
                        <PlayCircle className="h-4 w-4" />
                        Démarrer la migration
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Lancer le transfert de données vers le nœud destination</TooltipContent>
                  </Tooltip>
                )}
                {migration.status === 'running' && (
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Migration en cours…
                  </div>
                )}
                {migration.status === 'completed' && (
                  <div className="flex items-center justify-center gap-2 text-sm text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    Migration terminée avec succès
                  </div>
                )}
              </div>
            ))}
            {migrations.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Aucune migration. Cliquez sur «&nbsp;Nouvelle migration&nbsp;» pour en créer une.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Create Migration Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Créer une migration</DialogTitle>
            </DialogHeader>
            <form onSubmit={createMigration} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="migration-name">Nom de la migration</Label>
                <Input
                  id="migration-name"
                  placeholder="ex: Migration storage-1 vers storage-2"
                  value={migrationName}
                  onChange={(e) => setMigrationName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="source-node">Nœud source</Label>
                <Select value={migrationSourceNodeId} onValueChange={setMigrationSourceNodeId}>
                  <SelectTrigger id="source-node">
                    <SelectValue placeholder="Sélectionner une source" />
                  </SelectTrigger>
                  <SelectContent>
                    {nodes.map((n) => (
                      <SelectItem key={n.id} value={n.id}>{n.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="target-node">Nœud destination</Label>
                <Select value={migrationTargetNodeId} onValueChange={setMigrationTargetNodeId}>
                  <SelectTrigger id="target-node">
                    <SelectValue placeholder="Sélectionner une destination" />
                  </SelectTrigger>
                  <SelectContent>
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
                <Button type="submit">Créer migration</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
