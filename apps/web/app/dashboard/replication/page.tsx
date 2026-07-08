'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Copy,
  Check,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  RotateCw,
  KeyRound,
  Link2,
  Play,
  Trash2,
  History,
  Clock,
} from 'lucide-react';
import { api, API_BASE, NodeItem, SyncJobItem, SyncJobRunItem } from '../../../lib/api';
import { DashboardLayout } from '../../../components/DashboardLayout';
import { PageHeader } from '../../../components/PageHeader';
import { Callout } from '../../../components/Callout';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Badge, StatCard } from '../../../components/ui';
import { SectionLabel } from '../../../components/SectionLabel';
import { HelpText, InfoBox, StepConfig, WizardDialog } from '../../../components/ui/wizard';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../../components/ui/dialog';
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
  const [revealSecret, setRevealSecret] = useState<{ job: SyncJobItem; token: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    nodeId: '',
    sourcePath: '',
    targetPath: '',
    sourceHost: '',
    sourceUser: '',
    sourceSshPort: '',
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

  const resetForm = () =>
    setFormData({ name: '', nodeId: '', sourcePath: '', targetPath: '', sourceHost: '', sourceUser: '', sourceSshPort: '' });

  const copyToClipboard = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1600);
    } catch {
      setNotice({ type: 'error', message: 'Impossible de copier dans le presse-papiers.' });
    }
  };

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

          <div className="space-y-4 rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
            <div>
              <p className="text-sm font-medium text-zinc-200">
                Source distante (SSH) <span className="text-xs font-normal text-muted-foreground">— optionnel</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Pour tirer depuis un hôte externe (ex: seedbox Ultra.cc) plutôt qu&apos;un dossier local du nœud
                exécutant. Le dossier source ci-dessus est alors le chemin sur cet hôte distant, jamais supprimé ni
                modifié.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-400">Hôte</label>
                <input
                  type="text"
                  value={formData.sourceHost}
                  onChange={(e) => setFormData({ ...formData, sourceHost: e.target.value })}
                  placeholder="monuser.ultra.cc"
                  className="w-full rounded-lg border border-white/[0.12] bg-zinc-950/70 px-3 py-2 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-400">Utilisateur SSH</label>
                <input
                  type="text"
                  value={formData.sourceUser}
                  onChange={(e) => setFormData({ ...formData, sourceUser: e.target.value })}
                  placeholder="root"
                  className="w-full rounded-lg border border-white/[0.12] bg-zinc-950/70 px-3 py-2 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-zinc-400">Port SSH</label>
                <input
                  type="number"
                  value={formData.sourceSshPort}
                  onChange={(e) => setFormData({ ...formData, sourceSshPort: e.target.value })}
                  placeholder="22"
                  className="w-full rounded-lg border border-white/[0.12] bg-zinc-950/70 px-3 py-2 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
            </div>
            <InfoBox type="info" title="Authentification par clé, sans mot de passe stocké">
              Aucun mot de passe n&apos;est enregistré. Une fois la tâche créée, copiez la clé SSH publique de
              l&apos;agent (affichée sur la carte de la tâche) dans le fichier{' '}
              <code>~/.ssh/authorized_keys</code> de l&apos;hôte distant.
            </InfoBox>
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
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Destination :</span>
              <span className="font-mono">{formData.targetPath || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Source distante :</span>
              <span className="font-mono">
                {formData.sourceHost
                  ? `${formData.sourceUser || 'root'}@${formData.sourceHost}:${formData.sourceSshPort || '22'}`
                  : 'aucune (dossier local du nœud)'}
              </span>
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
    const sourceHost = formData.sourceHost.trim();
    const sourceUser = formData.sourceUser.trim();
    const sourceSshPort = formData.sourceSshPort.trim();
    try {
      const created = await api.syncJobs.create(token, {
        name: formData.name.trim(),
        sourcePath: formData.sourcePath.trim(),
        targetPath: formData.targetPath.trim(),
        schedule: 'manuel',
        nodeId: formData.nodeId || undefined,
        ...(sourceHost ? { sourceHost } : {}),
        ...(sourceHost && sourceUser ? { sourceUser } : {}),
        ...(sourceHost && sourceSshPort ? { sourceSshPort: Number(sourceSshPort) } : {}),
      });
      setNotice({ type: 'success', message: 'Tâche de réplication créée.' });
      if (created.triggerToken) {
        setRevealSecret({ job: created, token: created.triggerToken });
      }
      setWizardOpen(false);
      resetForm();
      await load();
    } catch {
      setNotice({ type: 'error', message: 'Erreur lors de la création de la tâche.' });
    }
  };

  const rotateTriggerToken = async (job: SyncJobItem) => {
    if (!token) return;
    setBusyJobId(job.id);
    try {
      const { triggerToken } = await api.syncJobs.rotateTriggerToken(token, job.id);
      setRevealSecret({ job, token: triggerToken });
    } catch {
      setNotice({ type: 'error', message: 'Erreur lors de la régénération du lien externe.' });
    } finally {
      setBusyJobId(null);
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
                          onClick={() => rotateTriggerToken(job)}
                        >
                          <RotateCw className="h-3.5 w-3.5" />
                          Lien externe
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

                    {job.sourceHost && (
                      <div className="space-y-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                        <p className="flex items-center gap-1.5 text-xs text-foreground/90">
                          <Link2 className="h-3.5 w-3.5" />
                          Source SSH distante : <span className="font-mono">{job.sourceUser || 'root'}@{job.sourceHost}:{job.sourceSshPort || 22}</span>
                        </p>
                        {job.node?.overlaySshPublicKey ? (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="flex items-center gap-1.5 text-xs">
                                <KeyRound className="h-3.5 w-3.5" />
                                Clé publique de l&apos;agent (à ajouter à <code>~/.ssh/authorized_keys</code> sur l&apos;hôte distant)
                              </p>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => copyToClipboard(job.node!.overlaySshPublicKey!, `sshkey-${job.id}`)}
                              >
                                {copiedKey === `sshkey-${job.id}` ? (
                                  <Check className="h-3.5 w-3.5" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </div>
                            <p className="truncate rounded border border-white/[0.06] bg-zinc-950/70 px-2 py-1.5 font-mono text-[11px] text-foreground/80">
                              {job.node.overlaySshPublicKey}
                            </p>
                          </div>
                        ) : (
                          <p className="text-xs text-amber-300/90">
                            Clé SSH de l&apos;agent pas encore reçue — attends que le nœud exécutant envoie un
                            heartbeat.
                          </p>
                        )}
                      </div>
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

      <Dialog open={!!revealSecret} onOpenChange={(open) => !open && setRevealSecret(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lien de déclenchement externe — « {revealSecret?.job.name} »</DialogTitle>
            <DialogDescription>
              Ce secret n&apos;est affiché qu&apos;une seule fois. Colle-le dans la commande « Run external program on
              torrent completion » de qBittorrent.
            </DialogDescription>
          </DialogHeader>
          {revealSecret && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-medium text-zinc-400">URL</label>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      copyToClipboard(`${API_BASE}/api/v1/sync-jobs/${revealSecret.job.id}/trigger`, 'trigger-url')
                    }
                  >
                    {copiedKey === 'trigger-url' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    Copier
                  </Button>
                </div>
                <p className="break-all rounded-lg border border-white/[0.08] bg-zinc-950/70 px-3 py-2 font-mono text-xs text-foreground/90">
                  {API_BASE}/api/v1/sync-jobs/{revealSecret.job.id}/trigger
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-medium text-zinc-400">En-tête X-Trigger-Token</label>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => copyToClipboard(revealSecret.token, 'trigger-token')}
                  >
                    {copiedKey === 'trigger-token' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    Copier
                  </Button>
                </div>
                <p className="break-all rounded-lg border border-white/[0.08] bg-zinc-950/70 px-3 py-2 font-mono text-xs text-foreground/90">
                  {revealSecret.token}
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-medium text-zinc-400">Commande qBittorrent (curl)</label>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      copyToClipboard(
                        `curl -sS -X POST -H "X-Trigger-Token: ${revealSecret.token}" "${API_BASE}/api/v1/sync-jobs/${revealSecret.job.id}/trigger"`,
                        'trigger-curl',
                      )
                    }
                  >
                    {copiedKey === 'trigger-curl' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    Copier
                  </Button>
                </div>
                <p className="break-all rounded-lg border border-white/[0.08] bg-zinc-950/70 px-3 py-2 font-mono text-xs text-foreground/90">
                  curl -sS -X POST -H &quot;X-Trigger-Token: {revealSecret.token}&quot; &quot;{API_BASE}/api/v1/sync-jobs/{revealSecret.job.id}/trigger&quot;
                </p>
              </div>

              <InfoBox type="warning" title="À conserver précieusement">
                Ce token ne sera plus jamais affiché. Si tu le perds, régénère-le depuis le bouton « Lien externe » —
                l&apos;ancien token sera immédiatement invalidé.
              </InfoBox>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
