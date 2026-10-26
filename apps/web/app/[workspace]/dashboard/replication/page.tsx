'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Plus,
  Copy,
  Check,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  RotateCw,
  KeyRound,
  Link2,
  Settings2,
  Pencil,
  Play,
  Trash2,
  History,
  Clock,
  MoreVertical,
} from 'lucide-react';
import { api, API_BASE, NodeItem, SyncJobItem, SyncJobRunItem } from '../../../../lib/api';
import { usePolling } from '../../../../lib/hooks/usePolling';
import { PageHeader } from '../../../../components/PageHeader';
import { AnimatedGradientText } from '../../../../components/ui/animated-gradient-text';
import { RainbowButton } from '../../../../components/ui/rainbow-button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../../../components/ui/dropdown-menu';
import { Alert, AlertDescription } from '../../../../components/ui/alert';
import { Badge, StatCard } from '../../../../components/ui';
import { CardListSkeleton, StatCardSkeleton } from '../../../../components/ui/skeleton';
import { SectionLabel } from '../../../../components/SectionLabel';
import { RESOURCE_STATUS, StatusDot, StatusPill, describe } from '../../../../components/ui/status';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../components/ui/tooltip';
import { formatBytes, formatDateTime, formatRelative, shortHostname } from '../../../../lib/format';
import { HelpText, InfoBox, StepConfig, WizardDialog } from '../../../../components/ui/wizard';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../../../components/ui/dialog';
import { useNodeLabels } from '../../../../lib/node-labels';

const STATUS_BADGE: Record<string, { label: string; type: 'success' | 'warning' | 'error' | 'info' }> = {
  success: { label: 'Réussi', type: 'success' },
  running: { label: 'En cours', type: 'info' },
  pending: { label: 'En attente', type: 'warning' },
  failed: { label: 'Échec', type: 'error' },
};

export default function ReplicationPage() {
  const { data: nodes = [] } = usePolling('nodes', api.nodes.list);
  const { data: jobs = [], mutate: refreshJobs, isLoading: jobsLoading } = usePolling('sync-jobs', api.syncJobs.list, { intervalMs: 20000 });
  const [wizardOpen, setWizardOpen] = useState(false);
  const [notice, setNotice] = useState<{ type: 'error' | 'success'; message: string } | null>(null);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [runsByJob, setRunsByJob] = useState<Record<string, SyncJobRunItem[]>>({});
  const nodeLabels = useNodeLabels();
  const [revealSecret, setRevealSecret] = useState<{ job: SyncJobItem; token: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [sshEditJob, setSshEditJob] = useState<SyncJobItem | null>(null);
  const [sshForm, setSshForm] = useState({ sourceHost: '', sourceUser: '', sourceSshPort: '' });
  const [savingSsh, setSavingSsh] = useState(false);
  const [generalEditJob, setGeneralEditJob] = useState<SyncJobItem | null>(null);
  const [generalForm, setGeneralForm] = useState({ name: '', targetPath: '' });
  const [savingGeneral, setSavingGeneral] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    nodeId: '',
    sourcePath: '',
    targetPath: '',
    sourceHost: '',
    sourceUser: '',
    sourceSshPort: '',
  });


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

  const wizardSteps: StepConfig[] = !wizardOpen ? [] : [
    {
      id: 'details',
      title: 'Tâche de réplication',
      description: 'Copiez un dossier vers un autre emplacement, sur le même nœud ou via un point de montage NFS',
      content: (
        <div className="space-y-4">
          <div>
            <Label className="mb-2 block text-sm font-medium text-foreground/90">
              Nom
              <HelpText text="Identifiant pour cette tâche de réplication" />
            </Label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="ex: backup-vers-node-2"
              className="h-10"
            />
          </div>

          <div>
            <Label className="mb-2 block text-sm font-medium text-foreground/90">
              Nœud exécutant
              <HelpText text="Le nœud dont l'agent lancera la commande rsync" />
            </Label>
            <Select value={formData.nodeId} onValueChange={(value) => setFormData({ ...formData, nodeId: value })}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="-- Choisir un nœud --" />
              </SelectTrigger>
              <SelectContent>
                {nodes.map((node) => (
                  <SelectItem key={node.id} value={node.id}>
                    {node.name} ({node.status}){(nodeLabels[node.id]?.length ?? 0) > 0 ? ` — ${nodeLabels[node.id].join(', ')}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="mb-2 block text-sm font-medium text-foreground/90">
              Dossier source
              <HelpText text="Chemin absolu à copier, sur le nœud exécutant" />
            </Label>
            <Input
              value={formData.sourcePath}
              onChange={(e) => setFormData({ ...formData, sourcePath: e.target.value })}
              placeholder="/data/movies"
              className="h-10 font-mono text-xs"
            />
          </div>

          <div>
            <Label className="mb-2 block text-sm font-medium text-foreground/90">
              Dossier destination
              <HelpText text="Chemin absolu où copier les données — un montage NFS vers un autre nœud fonctionne aussi" />
            </Label>
            <Input
              value={formData.targetPath}
              onChange={(e) => setFormData({ ...formData, targetPath: e.target.value })}
              placeholder="/mnt/replica-node-2/movies"
              className="h-10 font-mono text-xs"
            />
          </div>

          <div className="space-y-4 rounded-lg border border-border bg-surface-2 p-4">
            <div>
              <p className="text-sm font-medium text-foreground/90">
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
                <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">Hôte</Label>
                <Input
                  value={formData.sourceHost}
                  onChange={(e) => setFormData({ ...formData, sourceHost: e.target.value })}
                  placeholder="monuser.ultra.cc"
                  className="h-10 font-mono text-xs"
                />
              </div>
              <div>
                <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">Utilisateur SSH</Label>
                <Input
                  value={formData.sourceUser}
                  onChange={(e) => setFormData({ ...formData, sourceUser: e.target.value })}
                  placeholder="root"
                  className="h-10 font-mono text-xs"
                />
              </div>
              <div>
                <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">Port SSH</Label>
                <Input
                  type="number"
                  value={formData.sourceSshPort}
                  onChange={(e) => setFormData({ ...formData, sourceSshPort: e.target.value })}
                  placeholder="22"
                  className="h-10 font-mono text-xs"
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
          <div className="space-y-3 rounded-lg border border-border bg-zinc-900/60 p-4 text-sm">
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
    if (!formData.name.trim() || !formData.sourcePath.trim() || !formData.targetPath.trim()) {
      setNotice({ type: 'error', message: 'Nom, dossier source et dossier destination sont obligatoires.' });
      return;
    }
    const sourceHost = formData.sourceHost.trim();
    const sourceUser = formData.sourceUser.trim();
    const sourceSshPort = formData.sourceSshPort.trim();
    try {
      const created = await api.syncJobs.create({
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
      await refreshJobs();
    } catch {
      setNotice({ type: 'error', message: 'Erreur lors de la création de la tâche.' });
    }
  };

  const rotateTriggerToken = async (job: SyncJobItem) => {
    setBusyJobId(job.id);
    try {
      const { triggerToken } = await api.syncJobs.rotateTriggerToken(job.id);
      setRevealSecret({ job, token: triggerToken });
    } catch {
      setNotice({ type: 'error', message: 'Erreur lors de la régénération du lien externe.' });
    } finally {
      setBusyJobId(null);
    }
  };

  const openSshEdit = (job: SyncJobItem) => {
    setSshForm({
      sourceHost: job.sourceHost ?? '',
      sourceUser: job.sourceUser ?? '',
      sourceSshPort: job.sourceSshPort ? String(job.sourceSshPort) : '',
    });
    setSshEditJob(job);
  };

  const saveSshSource = async () => {
    if (!sshEditJob) return;
    const sourceHost = sshForm.sourceHost.trim();
    if (!sourceHost) {
      setNotice({ type: 'error', message: "L'hôte distant est obligatoire." });
      return;
    }
    const sourceUser = sshForm.sourceUser.trim();
    const sourceSshPort = sshForm.sourceSshPort.trim();
    setSavingSsh(true);
    try {
      await api.syncJobs.update(sshEditJob.id, {
        sourceHost,
        ...(sourceUser ? { sourceUser } : {}),
        ...(sourceSshPort ? { sourceSshPort: Number(sourceSshPort) } : {}),
      });
      setNotice({ type: 'success', message: 'Source SSH mise à jour.' });
      setSshEditJob(null);
      await refreshJobs();
    } catch {
      setNotice({ type: 'error', message: 'Erreur lors de la mise à jour de la source SSH.' });
    } finally {
      setSavingSsh(false);
    }
  };

  const openGeneralEdit = (job: SyncJobItem) => {
    setGeneralForm({ name: job.name, targetPath: job.targetPath });
    setGeneralEditJob(job);
  };

  const saveGeneralEdit = async () => {
    if (!generalEditJob) return;
    const name = generalForm.name.trim();
    const targetPath = generalForm.targetPath.trim();
    if (!name || !targetPath) {
      setNotice({ type: 'error', message: 'Nom et dossier destination sont obligatoires.' });
      return;
    }
    setSavingGeneral(true);
    try {
      await api.syncJobs.update(generalEditJob.id, { name, targetPath });
      setNotice({ type: 'success', message: 'Tâche mise à jour.' });
      setGeneralEditJob(null);
      await refreshJobs();
    } catch {
      setNotice({ type: 'error', message: 'Erreur lors de la mise à jour de la tâche.' });
    } finally {
      setSavingGeneral(false);
    }
  };

  const runJob = async (job: SyncJobItem) => {
    setBusyJobId(job.id);
    try {
      await api.syncJobs.run(job.id);
      setNotice({ type: 'success', message: `Réplication « ${job.name} » lancée.` });
      await refreshJobs();
    } catch {
      setNotice({ type: 'error', message: 'Erreur lors du lancement de la réplication.' });
    } finally {
      setBusyJobId(null);
    }
  };

  const deleteJob = async (job: SyncJobItem) => {
    if (!window.confirm(`Supprimer la tâche « ${job.name} » ? Cette action est définitive.`)) return;
    setBusyJobId(job.id);
    try {
      await api.syncJobs.delete(job.id);
      await refreshJobs();
    } catch {
      setNotice({ type: 'error', message: 'Erreur lors de la suppression de la tâche.' });
    } finally {
      setBusyJobId(null);
    }
  };

  const toggleHistory = async (job: SyncJobItem) => {
    if (expandedJobId === job.id) {
      setExpandedJobId(null);
      return;
    }
    setExpandedJobId(job.id);
    if (!runsByJob[job.id]) {
      const runs = await api.syncJobs.runs(job.id);
      setRunsByJob((prev) => ({ ...prev, [job.id]: runs }));
    }
  };

  const nodeName = (nodeId?: string | null) => (nodeId ? nodes.find((n) => n.id === nodeId)?.name ?? nodeId : '—');
  const successfulJobs = jobs.filter((job) => job.status === 'success').length;
  const failedJobs = jobs.filter((job) => job.status === 'failed').length;

  return (
    <>
      <div className="space-y-8">
        {notice && (
          <Alert variant={notice.type === 'error' ? 'destructive' : 'success'}>
            {notice.type === 'error' ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            <AlertDescription>{notice.message}</AlertDescription>
          </Alert>
        )}

        <PageHeader
          title="Réplication"
          description="Copiez des dossiers entre nœuds via rsync, à la demande."
          actions={
            <RainbowButton onClick={() => setWizardOpen(true)} className="gap-2">
              <Plus className="w-5 h-5" />
              Nouvelle réplication
            </RainbowButton>
          }
        />

        <section className="space-y-4">
          <SectionLabel>Aperçu</SectionLabel>
          {jobsLoading ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3 animate-fade-in">
              <StatCard label="Tâches" value={jobs.length} icon={<Copy className="h-8 w-8" />} changeType="neutral" />
              <StatCard label="Réussies" value={successfulJobs} icon={<CheckCircle2 className="h-8 w-8" />} changeType="up" />
              <StatCard
                label="Échouées"
                value={failedJobs}
                icon={<AlertCircle className="h-8 w-8" />}
                changeType={failedJobs > 0 ? 'down' : 'up'}
              />
            </div>
          )}
        </section>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionLabel>Tâches de réplication</SectionLabel>
          <p className="text-xs text-muted-foreground">
            Combinez avec un montage NFS (page Montages) pour répliquer vers un autre nœud.
          </p>
        </div>
        {jobsLoading ? (
          <CardListSkeleton cards={3} />
        ) : jobs.length === 0 ? (
          <Card className="border-border bg-surface-1 backdrop-blur">
            <CardContent className="pt-12 pb-12 text-center">
              <Copy className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
              <p className="font-medium text-muted-foreground">Aucune réplication active</p>
              <p className="mt-2 text-sm text-muted-foreground">Cliquez sur « Nouvelle réplication » pour en créer une.</p>
            </CardContent>
          </Card>
        ) : (
          /* Rows, not cards. Each job used to open with a header carrying
             two labelled buttons and a menu, then spend three more lines on
             a Nœud/Source/Destination grid - so four jobs filled a screen
             and none of them could be compared to the next. Everything a
             job is identified by now sits on one line, and the parts only
             some jobs have (a remote SSH source, the run history) unfold
             under the row that owns them. */
          <Card className="animate-fade-in">
            <CardContent flush>
              <ul className="divide-y divide-border">
                {jobs.map((job) => {
                  const status = describe(RESOURCE_STATUS, job.status);
                  const runs = runsByJob[job.id] ?? [];
                  const isExpanded = expandedJobId === job.id;
                  return (
                    <li key={job.id} className="group/row">
                      <div className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2 lg:px-5">
                        <StatusDot tone={status.tone} className="shrink-0" />

                        <span className="w-44 shrink-0 truncate text-sm font-medium text-foreground" title={job.name}>
                          {job.name}
                        </span>

                        <span className="flex min-w-0 flex-1 items-center gap-2 font-mono text-2xs text-muted-foreground">
                          <span className="truncate" title={job.sourcePath}>
                            {job.sourceHost ? `${job.sourceHost}:${job.sourcePath}` : job.sourcePath}
                          </span>
                          <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                          <span className="truncate text-foreground/80" title={job.targetPath}>
                            {job.targetPath}
                          </span>
                        </span>

                        <span className="w-28 shrink-0 truncate text-2xs text-muted-foreground" title={nodeName(job.nodeId)}>
                          {shortHostname(nodeName(job.nodeId))}
                        </span>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="tabular w-24 shrink-0 cursor-default text-right text-2xs text-muted-foreground">
                              {job.lastRunAt ? formatRelative(job.lastRunAt) : 'jamais'}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {job.lastRunAt
                              ? `Dernier lancement : ${formatDateTime(job.lastRunAt)}`
                              : 'Jamais exécutée'}
                            <br />
                            Planification : <span className="font-mono">{job.schedule}</span>
                          </TooltipContent>
                        </Tooltip>

                        <StatusPill tone={status.tone} className="w-24 shrink-0 justify-center">
                          {status.label}
                        </StatusPill>

                        {/* A fixed gutter, matching the mount and alert rows, so a
                            row that loses an action keeps its columns aligned
                            with its neighbours'. */}
                        <div className="flex w-[100px] shrink-0 items-center justify-end gap-0.5">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={busyJobId === job.id}
                                onClick={() => runJob(job)}
                              >
                                <Play className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Lancer maintenant</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => toggleHistory(job)}
                                className={isExpanded ? 'text-foreground' : undefined}
                              >
                                <History className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{isExpanded ? 'Masquer' : 'Historique et détails'}</TooltipContent>
                          </Tooltip>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" disabled={busyJobId === job.id} aria-label="Plus d'actions">
                                <MoreVertical className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openGeneralEdit(job)}>
                                <Pencil className="h-4 w-4" />
                                Modifier
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openSshEdit(job)}>
                                <Settings2 className="h-4 w-4" />
                                Source SSH
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => rotateTriggerToken(job)}>
                                <RotateCw className="h-4 w-4" />
                                Lien externe
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => deleteJob(job)}
                                className="text-[hsl(var(--danger))] focus:text-[hsl(var(--danger))]"
                              >
                                <Trash2 className="h-4 w-4" />
                                Supprimer
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="space-y-3 border-t border-border bg-surface-2/40 px-4 py-3 lg:px-5">
                          {job.sourceHost && (
                            <div className="space-y-1.5">
                              <p className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                                <Link2 className="h-3.5 w-3.5" />
                                Source SSH distante :{' '}
                                <span className="font-mono text-foreground/80">
                                  {job.sourceUser || 'root'}@{job.sourceHost}:{job.sourceSshPort || 22}
                                </span>
                              </p>
                              {job.node?.overlaySshPublicKey ? (
                                <div className="flex items-center gap-2">
                                  <p className="min-w-0 flex-1 truncate rounded border border-border bg-background px-2 py-1 font-mono text-2xs text-foreground/80">
                                    {job.node.overlaySshPublicKey}
                                  </p>
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    className="shrink-0 gap-1.5"
                                    onClick={() => copyToClipboard(job.node!.overlaySshPublicKey!, `sshkey-${job.id}`)}
                                  >
                                    {copiedKey === `sshkey-${job.id}` ? (
                                      <Check className="h-3.5 w-3.5" />
                                    ) : (
                                      <KeyRound className="h-3.5 w-3.5" />
                                    )}
                                    Clé de l&apos;agent
                                  </Button>
                                </div>
                              ) : (
                                <p className="text-2xs text-[hsl(var(--warn))]">
                                  Clé SSH de l&apos;agent pas encore reçue — attends que le nœud exécutant envoie un
                                  heartbeat.
                                </p>
                              )}
                            </div>
                          )}

                          <div>
                            <p className="mb-1.5 text-2xs uppercase tracking-wider text-muted-foreground">
                              Dernières exécutions
                            </p>
                            {runs.length === 0 ? (
                              <p className="text-2xs text-muted-foreground">Aucune exécution pour le moment.</p>
                            ) : (
                              <ul className="space-y-1">
                                {runs.map((run) => {
                                  const runStatus = describe(RESOURCE_STATUS, run.status);
                                  return (
                                    <li key={run.id} className="flex items-center gap-3 text-2xs text-muted-foreground">
                                      <span className="tabular w-32 shrink-0">{formatDateTime(run.startedAt)}</span>
                                      <span className="tabular w-20 shrink-0 text-right">
                                        {formatBytes(run.bytesTransferred)}
                                      </span>
                                      <StatusPill tone={runStatus.tone} dot={false}>
                                        {runStatus.label}
                                      </StatusPill>
                                      {run.log && (
                                        <span className="min-w-0 flex-1 truncate font-mono" title={run.log}>
                                          {run.log}
                                        </span>
                                      )}
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
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
                  <label className="text-xs font-medium text-muted-foreground">URL</label>
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
                <p className="break-all rounded-lg border border-border bg-zinc-950/70 px-3 py-2 font-mono text-xs text-foreground/90">
                  {API_BASE}/api/v1/sync-jobs/{revealSecret.job.id}/trigger
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-medium text-muted-foreground">En-tête X-Trigger-Token</label>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => copyToClipboard(revealSecret.token, 'trigger-token')}
                  >
                    {copiedKey === 'trigger-token' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    Copier
                  </Button>
                </div>
                <p className="break-all rounded-lg border border-border bg-zinc-950/70 px-3 py-2 font-mono text-xs text-foreground/90">
                  {revealSecret.token}
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    Commande qBittorrent (curl) — ne resynchronise que le torrent terminé
                  </label>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      copyToClipboard(
                        `curl -sS -X POST -H "X-Trigger-Token: ${revealSecret.token}" -G --data-urlencode "relativePath=%N" "${API_BASE}/api/v1/sync-jobs/${revealSecret.job.id}/trigger"`,
                        'trigger-curl',
                      )
                    }
                  >
                    {copiedKey === 'trigger-curl' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    Copier
                  </Button>
                </div>
                <p className="break-all rounded-lg border border-border bg-zinc-950/70 px-3 py-2 font-mono text-xs text-foreground/90">
                  curl -sS -X POST -H &quot;X-Trigger-Token: {revealSecret.token}&quot; -G --data-urlencode
                  &quot;relativePath=%N&quot; &quot;{API_BASE}/api/v1/sync-jobs/{revealSecret.job.id}/trigger&quot;
                </p>
              </div>

              <InfoBox type="info" title="%N = nom du torrent, laisse tel quel">
                qBittorrent remplace <code>%N</code> par le nom du torrent avant d&apos;exécuter la commande. Ça permet
                de ne rapatrier que ce torrent précis plutôt que de resynchroniser tout le dossier — donc un fichier
                déjà déplacé ailleurs (par Radarr par exemple) après un précédent passage n&apos;est jamais retransféré.
                Vérifie que l&apos;option qBittorrent « Garder le dossier de premier niveau » (Keep top-level folder)
                est activée pour cette catégorie, sinon <code>%N</code> ne correspondra à rien côté seedbox.
              </InfoBox>

              <InfoBox type="warning" title="À conserver précieusement">
                Ce token ne sera plus jamais affiché. Si tu le perds, régénère-le depuis le bouton « Lien externe » —
                l&apos;ancien token sera immédiatement invalidé.
              </InfoBox>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!sshEditJob} onOpenChange={(open) => !open && setSshEditJob(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Source SSH distante — « {sshEditJob?.name} »</DialogTitle>
            <DialogDescription>
              Modifie l&apos;hôte, l&apos;utilisateur ou le port SSH sans recréer la tâche. Le dossier source
              (chemin sur cet hôte) reste inchangé.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Hôte</label>
              <input
                type="text"
                value={sshForm.sourceHost}
                onChange={(e) => setSshForm({ ...sshForm, sourceHost: e.target.value })}
                placeholder="monuser.ultra.cc"
                className="w-full rounded-lg border border-white/[0.12] bg-zinc-950/70 px-3 py-2 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Utilisateur SSH</label>
                <input
                  type="text"
                  value={sshForm.sourceUser}
                  onChange={(e) => setSshForm({ ...sshForm, sourceUser: e.target.value })}
                  placeholder="root"
                  className="w-full rounded-lg border border-white/[0.12] bg-zinc-950/70 px-3 py-2 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Port SSH</label>
                <input
                  type="number"
                  value={sshForm.sourceSshPort}
                  onChange={(e) => setSshForm({ ...sshForm, sourceSshPort: e.target.value })}
                  placeholder="22"
                  className="w-full rounded-lg border border-white/[0.12] bg-zinc-950/70 px-3 py-2 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setSshEditJob(null)}>
              Annuler
            </Button>
            <Button type="button" onClick={saveSshSource} disabled={savingSsh}>
              {savingSsh ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!generalEditJob} onOpenChange={(open) => !open && setGeneralEditJob(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier la tâche — « {generalEditJob?.name} »</DialogTitle>
            <DialogDescription>
              Change le nom ou le dossier destination sans recréer la tâche (historique et lien externe conservés).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Nom</label>
              <input
                type="text"
                value={generalForm.name}
                onChange={(e) => setGeneralForm({ ...generalForm, name: e.target.value })}
                className="w-full rounded-lg border border-white/[0.12] bg-zinc-950/70 px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Dossier destination</label>
              <input
                type="text"
                value={generalForm.targetPath}
                onChange={(e) => setGeneralForm({ ...generalForm, targetPath: e.target.value })}
                placeholder="/data/incoming/radarr"
                className="w-full rounded-lg border border-white/[0.12] bg-zinc-950/70 px-3 py-2 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
          </div>
          <InfoBox type="warning" title="Pense au dossier déjà en place">
            Si des fichiers traînent déjà dans l&apos;ancien dossier destination, ils n&apos;y seront pas déplacés
            automatiquement — et pense à mettre à jour le root folder correspondant dans Radarr/Sonarr.
          </InfoBox>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setGeneralEditJob(null)}>
              Annuler
            </Button>
            <Button type="button" onClick={saveGeneralEdit} disabled={savingGeneral}>
              {savingGeneral ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
