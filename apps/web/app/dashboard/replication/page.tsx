'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Copy,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Play,
  Trash2,
  History,
  Clock,
} from 'lucide-react';
import { api, NodeItem, SyncJobItem, SyncJobRunItem } from '../../../lib/api';
import { DashboardLayout } from '../../../components/DashboardLayout';
import { PageHeader } from '../../../components/PageHeader';
import { Callout } from '../../../components/Callout';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Badge, StatCard } from '../../../components/ui';
import { SectionLabel } from '../../../components/SectionLabel';
import { HelpText, InfoBox, StepConfig, WizardDialog } from '../../../components/ui/wizard';
import { readNodeLabels } from '../../../lib/node-labels';

const STATUS_BADGE: Record<string, { label: string; type: 'success' | 'warning' | 'error' | 'info' }> = {
  success: { label: 'Réussi', type: 'success' },
  running: { label: 'En cours', type: 'info' },
  pending: { label: 'En attente', type: 'warning' },
  failed: { label: 'Échec', type: 'error' },
};

export default function ReplicationPage() {
  const router = useRouter();
  const token = useMemo(() => (typeof window !== 'undefined' ? localStorage.getItem('tarmac_token') : null), []);

  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [jobs, setJobs] = useState<SyncJobItem[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [notice, setNotice] = useState<{ type: 'error' | 'success'; message: string } | null>(null);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [runsByJob, setRunsByJob] = useState<Record<string, SyncJobRunItem[]>>({});
  const [nodeLabels, setNodeLabels] = useState<Record<string, string[]>>({});

  const [formData, setFormData] = useState({
    name: '',
    nodeId: '',
    sourcePath: '',
    targetPath: '',
  });

  const load = async () => {
    if (!token) return;
    try {
      const [n, j] = await Promise.all([api.nodes.list(token), api.syncJobs.list(token)]);
      setNodes(n);
      setJobs(j);
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
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [token]);

  useEffect(() => {
    setNodeLabels(readNodeLabels());
  }, []);

  const resetForm = () => setFormData({ name: '', nodeId: '', sourcePath: '', targetPath: '' });

  const wizardSteps: StepConfig[] = [
    {
      id: 'details',
      title: 'Tâche de réplication',
      description: 'Copiez un dossier vers un autre emplacement, sur le même nœud ou via un point de montage NFS',
      content: (
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-200">
              Nom
              <HelpText text="Identifiant pour cette tâche de réplication" />
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="ex: backup-vers-node-2"
              className="w-full rounded-lg border border-white/[0.12] bg-zinc-950/70 px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-200">
              Nœud exécutant
              <HelpText text="Le nœud dont l'agent lancera la commande rsync" />
            </label>
            <select
              value={formData.nodeId}
              onChange={(e) => setFormData({ ...formData, nodeId: e.target.value })}
              className="w-full rounded-lg border border-white/[0.12] bg-zinc-950/70 px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              <option value="">-- Choisir un nœud --</option>
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name} ({node.status}){(nodeLabels[node.id]?.length ?? 0) > 0 ? ` — ${nodeLabels[node.id].join(', ')}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-200">
              Dossier source
              <HelpText text="Chemin absolu à copier, sur le nœud exécutant" />
            </label>
            <input
              type="text"
              value={formData.sourcePath}
              onChange={(e) => setFormData({ ...formData, sourcePath: e.target.value })}
              placeholder="/data/movies"
              className="w-full rounded-lg border border-white/[0.12] bg-zinc-950/70 px-3 py-2 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-200">
              Dossier destination
              <HelpText text="Chemin absolu où copier les données — un montage NFS vers un autre nœud fonctionne aussi" />
            </label>
            <input
              type="text"
              value={formData.targetPath}
              onChange={(e) => setFormData({ ...formData, targetPath: e.target.value })}
              placeholder="/mnt/replica-node-2/movies"
              className="w-full rounded-lg border border-white/[0.12] bg-zinc-950/70 px-3 py-2 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>
        </div>
      ),
    },
    {
      id: 'review',
      title: 'Vérification',
      description: 'Confirmer la création de la tâche',
      content: (
        <div className="space-y-4">
          <div className="space-y-3 rounded-lg border border-white/[0.08] bg-zinc-900/60 p-4 text-sm">
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Nom :</span>
              <span className="font-mono font-semibold">{formData.name || '—'}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Nœud :</span>
              <span className="font-mono">{nodes.find((n) => n.id === formData.nodeId)?.name ?? '—'}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Source :</span>
              <span className="font-mono">{formData.sourcePath || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Destination :</span>
              <span className="font-mono">{formData.targetPath || '—'}</span>
            </div>
          </div>

          <InfoBox type="info" title="Déclenchement">
            La tâche est créée mais ne se lance pas automatiquement : utilisez le bouton « Lancer maintenant » depuis
            la liste pour exécuter la copie via l'agent du nœud.
          </InfoBox>
        </div>
      ),
    },
  ];

  const createJob = async () => {
    if (!token) return;
    if (!formData.name.trim() || !formData.sourcePath.trim() || !formData.targetPath.trim()) {
      setNotice({ type: 'error', message: 'Nom, dossier source et dossier destination sont obligatoires.' });
      return;
    }
    try {
      await api.syncJobs.create(token, {
        name: formData.name.trim(),
        sourcePath: formData.sourcePath.trim(),
        targetPath: formData.targetPath.trim(),
        schedule: 'manuel',
        nodeId: formData.nodeId || undefined,
      });
      setNotice({ type: 'success', message: 'Tâche de réplication créée.' });
      setWizardOpen(false);
      resetForm();
      await load();
    } catch {
      setNotice({ type: 'error', message: 'Erreur lors de la création de la tâche.' });
    }
  };

  const runJob = async (job: SyncJobItem) => {
    if (!token) return;
    setBusyJobId(job.id);
    try {
      await api.syncJobs.run(token, job.id);
      setNotice({ type: 'success', message: `Réplication « ${job.name} » lancée.` });
      await load();
    } catch {
      setNotice({ type: 'error', message: 'Erreur lors du lancement de la réplication.' });
    } finally {
      setBusyJobId(null);
    }
  };

  const deleteJob = async (job: SyncJobItem) => {
    if (!token) return;
    if (!window.confirm(`Supprimer la tâche « ${job.name} » ? Cette action est définitive.`)) return;
    setBusyJobId(job.id);
    try {
      await api.syncJobs.delete(token, job.id);
      await load();
    } catch {
      setNotice({ type: 'error', message: 'Erreur lors de la suppression de la tâche.' });
    } finally {
      setBusyJobId(null);
    }
  };

  const toggleHistory = async (job: SyncJobItem) => {
    if (!token) return;
    if (expandedJobId === job.id) {
      setExpandedJobId(null);
      return;
    }
    setExpandedJobId(job.id);
    if (!runsByJob[job.id]) {
      const runs = await api.syncJobs.runs(token, job.id);
      setRunsByJob((prev) => ({ ...prev, [job.id]: runs }));
    }
  };

  const nodeName = (nodeId?: string | null) => (nodeId ? nodes.find((n) => n.id === nodeId)?.name ?? nodeId : '—');
  const successfulJobs = jobs.filter((job) => job.status === 'success').length;
  const failedJobs = jobs.filter((job) => job.status === 'failed').length;

  return (
    <DashboardLayout>
      <div className="space-y-8">
        {notice && (
          <Alert variant={notice.type === 'error' ? 'destructive' : 'success'}>
            {notice.type === 'error' ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            <AlertDescription>{notice.message}</AlertDescription>
          </Alert>
        )}

        <PageHeader
          icon={RefreshCw}
          title="Réplication"
          description="Copiez des dossiers entre nœuds via rsync, à la demande."
          actions={
            <Button onClick={() => setWizardOpen(true)} className="gap-2 bg-violet-600 text-white hover:bg-violet-500">
              <Plus className="w-5 h-5" />
              Nouvelle réplication
            </Button>
          }
        />

        <section className="space-y-4">
          <SectionLabel>Aperçu</SectionLabel>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <StatCard label="Tâches" value={jobs.length} icon={<Copy className="h-8 w-8" />} changeType="neutral" />
            <StatCard label="Réussies" value={successfulJobs} icon={<CheckCircle2 className="h-8 w-8" />} changeType="up" />
            <StatCard
              label="Échouées"
              value={failedJobs}
              icon={<AlertCircle className="h-8 w-8" />}
              changeType={failedJobs > 0 ? 'down' : 'up'}
            />
          </div>
        </section>

        <Callout variant="info">
          Chaque tâche copie un dossier source vers une destination via l'agent du nœud choisi. Combinez-la avec un
          montage NFS (page Montages) pour répliquer réellement vers un autre nœud.
        </Callout>

        <SectionLabel>Tâches de réplication</SectionLabel>
        {jobs.length === 0 ? (
          <Card className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
            <CardContent className="pt-12 pb-12 text-center">
              <Copy className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
              <p className="font-medium text-muted-foreground">Aucune réplication active</p>
              <p className="mt-2 text-sm text-muted-foreground">Cliquez sur « Nouvelle réplication » pour en créer une.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {jobs.map((job) => {
              const statusBadge = STATUS_BADGE[job.status] ?? STATUS_BADGE.pending;
              const runs = runsByJob[job.id] ?? [];
              return (
                <Card key={job.id} className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="flex items-center gap-2">
                        <Copy className="w-5 h-5 text-violet-400" />
                        {job.name}
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        <Badge label={statusBadge.label} type={statusBadge.type} />
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busyJobId === job.id}
                          onClick={() => runJob(job)}
                        >
                          <Play className="h-3.5 w-3.5" />
                          Lancer maintenant
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => toggleHistory(job)}>
                          <History className="h-3.5 w-3.5" />
                          Historique
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busyJobId === job.id}
                          onClick={() => deleteJob(job)}
                          className="text-rose-300 hover:text-rose-200"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Supprimer
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-muted-foreground">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div>
                        <p className="text-xs text-muted-foreground">Nœud</p>
                        <p className="font-mono text-foreground/90">{nodeName(job.nodeId)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Source</p>
                        <p className="font-mono text-foreground/90">{job.sourcePath}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Destination</p>
                        <p className="font-mono text-foreground/90">{job.targetPath}</p>
                      </div>
                    </div>
                    {job.lastRunAt && (
                      <p className="flex items-center gap-1.5 text-xs">
                        <Clock className="h-3.5 w-3.5" />
                        Dernier lancement : {new Date(job.lastRunAt).toLocaleString('fr-FR')}
                      </p>
                    )}

                    {expandedJobId === job.id && (
                      <div className="space-y-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                        {runs.length === 0 && <p className="text-xs">Aucune exécution pour le moment.</p>}
                        {runs.map((run) => {
                          const runBadge = STATUS_BADGE[run.status] ?? STATUS_BADGE.pending;
                          return (
                            <div key={run.id} className="flex items-center justify-between text-xs">
                              <span>{new Date(run.startedAt).toLocaleString('fr-FR')}</span>
                              <span>{(run.bytesTransferred / 1_000_000).toFixed(1)} MB</span>
                              <Badge label={runBadge.label} type={runBadge.type} />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {wizardOpen && (
        <WizardDialog
          title="Créer une tâche de réplication"
          description="Guide pas à pas pour copier un dossier vers un autre emplacement"
          steps={wizardSteps}
          onComplete={createJob}
          onCancel={() => {
            setWizardOpen(false);
            resetForm();
          }}
          completeButtonLabel="Créer la tâche"
        />
      )}
    </DashboardLayout>
  );
}
