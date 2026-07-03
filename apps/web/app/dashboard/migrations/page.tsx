'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRightLeft, Plus, PlayCircle, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { api, MigrationItem, NodeItem } from '../../../lib/api';
import { DashboardLayout } from '../../../components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Progress } from '../../../components/ui/progress';
import { Button } from '../../../components/ui/button';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import {
  WizardDialog,
  PresetSelector,
  OperationPreview,
  HelpText,
  InfoBox,
  PresetOption,
  StepConfig,
} from '../../../components/ui/wizard';

const MIGRATION_PRESETS: PresetOption[] = [
  {
    id: 'maintenance',
    name: 'Maintenance Planifiée',
    description: 'Migrer les données avant une maintenance serveur',
    icon: '🔧',
    config: {
      reason: 'planned-maintenance',
    },
  },
  {
    id: 'load-balance',
    name: 'Rééquilibrage de Charge',
    description: 'Redistribuer les données pour optimiser les ressources',
    icon: '⚖️',
    config: {
      reason: 'load-balancing',
    },
  },
  {
    id: 'disk-replacement',
    name: 'Remplacement de Disque',
    description: 'Migrer avant le remplacement d\'un disque défaillant',
    icon: '💾',
    config: {
      reason: 'disk-replacement',
    },
  },
  {
    id: 'decommission',
    name: 'Décommissionnement',
    description: 'Migrer toutes les données avant retrait du serveur',
    icon: '🗑️',
    config: {
      reason: 'decommission',
    },
  },
];

export default function MigrationsPage() {
  const router = useRouter();
  const token = useMemo(() => (typeof window !== 'undefined' ? localStorage.getItem('tarmac_token') : null), []);

  const [migrations, setMigrations] = useState<MigrationItem[]>([]);
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<PresetOption | null>(null);
  const [notice, setNotice] = useState<{ type: 'error' | 'success'; message: string } | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    sourceNodeId: '',
    targetNodeId: '',
    sourcePath: '',
    targetPath: '',
    reason: '',
  });
  const [sourceDirectories, setSourceDirectories] = useState<string[]>([]);
  const [targetDirectories, setTargetDirectories] = useState<string[]>([]);
  const [sourceBrowsePath, setSourceBrowsePath] = useState('/');
  const [targetBrowsePath, setTargetBrowsePath] = useState('/');
  const [directoriesLoading, setDirectoriesLoading] = useState<{ source: boolean; target: boolean }>({
    source: false,
    target: false,
  });

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

  const loadDirectories = async (kind: 'source' | 'target', nodeId: string, basePath: string) => {
    if (!token || !nodeId) return;
    setDirectoriesLoading((prev) => ({ ...prev, [kind]: true }));
    try {
      const payload = await api.migrations.listDirectories(token, nodeId, basePath || '/');
      const sorted = [...payload.directories].sort((a, b) => a.localeCompare(b));
      if (kind === 'source') {
        setSourceBrowsePath(payload.basePath);
        setSourceDirectories(sorted);
      } else {
        setTargetBrowsePath(payload.basePath);
        setTargetDirectories(sorted);
      }
    } catch {
      if (kind === 'source') {
        setSourceDirectories([]);
      } else {
        setTargetDirectories([]);
      }
      setNotice({
        type: 'error',
        message: "Impossible de charger les dossiers en direct depuis le serveur sélectionné.",
      });
    } finally {
      setDirectoriesLoading((prev) => ({ ...prev, [kind]: false }));
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
    if (!formData.sourceNodeId) {
      setSourceDirectories([]);
      return;
    }
    void loadDirectories('source', formData.sourceNodeId, sourceBrowsePath);
  }, [formData.sourceNodeId]);

  useEffect(() => {
    if (!formData.targetNodeId) {
      setTargetDirectories([]);
      return;
    }
    void loadDirectories('target', formData.targetNodeId, targetBrowsePath);
  }, [formData.targetNodeId]);

  const wizardSteps: StepConfig[] = [
    {
      id: 'choose-preset',
      title: 'Raison de la Migration',
      description: 'Sélectionnez pourquoi vous migrez les données',
      content: (
        <div>
          <PresetSelector
            presets={MIGRATION_PRESETS}
            onSelect={(preset) => {
              setSelectedPreset(preset);
              if (preset.config) {
                setFormData((prev) => ({ ...prev, ...preset.config }));
              }
            }}
          />
          {selectedPreset && (
            <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.08] p-3 text-sm text-emerald-100">
              ✓ Sélectionné: <strong>{selectedPreset.name}</strong>
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'select-nodes',
      title: 'Serveurs Source et Destination',
      description: 'Choisissez d\'où proviennent les données et où les envoyer',
      content: (
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-200">
              Nom de la migration
              <HelpText text="Donnez un nom descriptif à cette tâche de migration" />
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="ex: Migration storage-1 vers storage-2"
              className="w-full rounded-lg border border-white/[0.12] bg-zinc-950/70 px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-200">
              Serveur Source
              <HelpText text="Le serveur dont vous migrez les données" />
            </label>
            <select
              value={formData.sourceNodeId}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  sourceNodeId: e.target.value,
                  targetNodeId: formData.targetNodeId === e.target.value ? '' : formData.targetNodeId,
                  sourcePath: '',
                  targetPath: '',
                })
              }
              className="w-full rounded-lg border border-white/[0.12] bg-zinc-950/70 px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              <option value="">-- Choisir un serveur source --</option>
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name} ({node.status})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-200">
              Serveur Destination
              <HelpText text="Le serveur qui recevra les données" />
            </label>
            <select
              value={formData.targetNodeId}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  targetNodeId: e.target.value,
                  targetPath: '',
                })
              }
              className="w-full rounded-lg border border-white/[0.12] bg-zinc-950/70 px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              <option value="">-- Choisir un serveur destination --</option>
              {nodes
                .filter((n) => n.id !== formData.sourceNodeId)
                .map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name} ({node.status})
                  </option>
                ))}
            </select>
          </div>

          <div className="space-y-2 rounded-lg border border-white/[0.08] bg-zinc-900/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <label className="block text-sm font-medium text-zinc-200">
                Dossier source (live)
                <HelpText text="Dossier lu en direct sur le serveur source via l'agent connecté" />
              </label>
              <Button
                type="button"
                variant="outline"
                className="h-8"
                onClick={() => void loadDirectories('source', formData.sourceNodeId, sourceBrowsePath)}
                disabled={!formData.sourceNodeId || directoriesLoading.source}
              >
                {directoriesLoading.source ? 'Chargement…' : 'Actualiser'}
              </Button>
            </div>
            <div className="grid gap-2 md:grid-cols-[1fr_auto]">
              <input
                type="text"
                value={sourceBrowsePath}
                onChange={(e) => setSourceBrowsePath(e.target.value || '/')}
                className="w-full rounded-lg border border-white/[0.12] bg-zinc-950/70 px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
                placeholder="/"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void loadDirectories('source', formData.sourceNodeId, sourceBrowsePath)}
                disabled={!formData.sourceNodeId || directoriesLoading.source}
              >
                Ouvrir
              </Button>
            </div>
            <select
              value={formData.sourcePath}
              onChange={(e) => setFormData({ ...formData, sourcePath: e.target.value })}
              className="w-full rounded-lg border border-white/[0.12] bg-zinc-950/70 px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              <option value="">-- Choisir un dossier source --</option>
              {sourceDirectories.map((path) => (
                <option key={path} value={path}>
                  {path}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2 rounded-lg border border-white/[0.08] bg-zinc-900/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <label className="block text-sm font-medium text-zinc-200">
                Dossier destination (live)
                <HelpText text="Chemin de destination final sur le serveur de réception" />
              </label>
              <Button
                type="button"
                variant="outline"
                className="h-8"
                onClick={() => void loadDirectories('target', formData.targetNodeId, targetBrowsePath)}
                disabled={!formData.targetNodeId || directoriesLoading.target}
              >
                {directoriesLoading.target ? 'Chargement…' : 'Actualiser'}
              </Button>
            </div>
            <div className="grid gap-2 md:grid-cols-[1fr_auto]">
              <input
                type="text"
                value={targetBrowsePath}
                onChange={(e) => setTargetBrowsePath(e.target.value || '/')}
                className="w-full rounded-lg border border-white/[0.12] bg-zinc-950/70 px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
                placeholder="/"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void loadDirectories('target', formData.targetNodeId, targetBrowsePath)}
                disabled={!formData.targetNodeId || directoriesLoading.target}
              >
                Ouvrir
              </Button>
            </div>
            <select
              value={formData.targetPath}
              onChange={(e) => setFormData({ ...formData, targetPath: e.target.value })}
              className="w-full rounded-lg border border-white/[0.12] bg-zinc-950/70 px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              <option value="">-- Choisir un dossier destination --</option>
              {targetDirectories.map((path) => (
                <option key={path} value={path}>
                  {path}
                </option>
              ))}
            </select>
          </div>
        </div>
      ),
    },
    {
      id: 'review',
      title: 'Vérification Finale',
      description: 'Vérifiez les paramètres avant de lancer la migration',
      content: (
        <div className="space-y-4">
          <OperationPreview
            steps={[
              {
                id: 'validate',
                title: 'Validation de la connectivité',
                description: 'Vérification des serveurs source et destination',
              },
              {
                id: 'prepare',
                title: 'Préparation du transfert',
                description: 'Synchronisation des données',
              },
              {
                id: 'transfer',
                title: 'Transfert des données',
                description: 'Migration sécurisée via le réseau VLAN',
              },
              {
                id: 'verify',
                title: 'Vérification et finalisation',
                description: 'Contrôle d\'intégrité et mise à jour du catalogage',
              },
            ]}
          />

          <div className="space-y-3 rounded-lg border border-white/[0.08] bg-zinc-900/60 p-4 text-sm">
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Migration:</span>
              <span className="font-mono font-semibold">{formData.name}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Source:</span>
              <span className="font-mono">{nodes.find((n) => n.id === formData.sourceNodeId)?.name}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Destination:</span>
              <span className="font-mono">{nodes.find((n) => n.id === formData.targetNodeId)?.name}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Dossier source:</span>
              <span className="font-mono break-all text-right">{formData.sourcePath || '—'}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Dossier destination:</span>
              <span className="font-mono break-all text-right">{formData.targetPath || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Raison:</span>
              <span className="font-mono">{selectedPreset?.name}</span>
            </div>
          </div>

          <InfoBox type="warning" title="Important">
            Le transfert peut prendre plusieurs minutes selon la quantité de données. Assurez-vous que les deux
            serveurs restent en ligne pendant toute la durée de l'opération.
          </InfoBox>
        </div>
      ),
    },
  ];

  const createMigration = async () => {
    if (!token) return;
    if (!formData.name || !formData.sourceNodeId || !formData.targetNodeId || !formData.sourcePath || !formData.targetPath) {
      setNotice({
        type: 'error',
        message: 'Merci de renseigner le nom, les serveurs et les dossiers source/destination.',
      });
      return;
    }
    try {
      await api.migrations.create(token, {
        name: formData.name,
        sourceNodeId: formData.sourceNodeId || undefined,
        targetNodeId: formData.targetNodeId || undefined,
        sourcePath: formData.sourcePath || undefined,
        targetPath: formData.targetPath || undefined,
        reason: formData.reason || undefined,
      });
      setWizardOpen(false);
      setFormData({
        name: '',
        sourceNodeId: '',
        targetNodeId: '',
        sourcePath: '',
        targetPath: '',
        reason: '',
      });
      setSelectedPreset(null);
      await load();
    } catch (error) {
      setNotice({ type: 'error', message: 'Erreur lors de la création de la migration.' });
    }
  };

  const startMigration = async (migrationId: string) => {
    if (!token) return;
    try {
      await api.migrations.start(token, migrationId);
      await load();
    } catch {
      setNotice({
        type: 'error',
        message: "Impossible de démarrer la migration. Vérifiez les chemins et la connectivité entre nœuds.",
      });
    }
  };

  const statusIcons = {
    pending: '⏳',
    running: '▶️',
    completed: '✅',
    failed: '❌',
  };

  const statusColors = {
    pending: 'border-amber-500/30 bg-amber-500/[0.08] text-amber-100',
    running: 'border-sky-500/30 bg-sky-500/[0.08] text-sky-100',
    completed: 'border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-100',
    failed: 'border-rose-500/30 bg-rose-500/[0.08] text-rose-100',
  };

  return (
    <DashboardLayout>
      <div className="space-y-8">
        {notice && (
          <Alert variant={notice.type === 'error' ? 'destructive' : 'success'}>
            {notice.type === 'error' ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            <AlertDescription>{notice.message}</AlertDescription>
          </Alert>
        )}

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Migrations de Données</h1>
            <p className="mt-1 text-sm text-muted-foreground">Déplacez vos données entre serveurs en toute sécurité.</p>
          </div>
          <Button
            onClick={() => setWizardOpen(true)}
            className="gap-2 bg-violet-600 text-white hover:bg-violet-500"
          >
            <Plus className="w-5 h-5" />
            Nouvelle Migration
          </Button>
        </div>

        {/* Info Box */}
        <InfoBox type="info" title="À propos des migrations">
          Les migrations permettent de déplacer les données d'un serveur à l'autre de manière sécurisée et vérifiée. Cela
          est utile lors de maintenance, rééquilibrage de charge, ou décommissionnement d'un serveur.
        </InfoBox>

        {/* Migrations List */}
        {migrations.length === 0 ? (
          <Card className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
            <CardContent className="pt-12 pb-12 text-center">
              <div className="text-6xl mb-4">📊</div>
              <p className="font-medium text-muted-foreground">Aucune migration en cours</p>
              <p className="mt-2 text-sm text-muted-foreground">Cliquez sur "Nouvelle Migration" pour démarrer.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {migrations.map((migration) => (
              <Card
                key={migration.id}
                className={`border-white/[0.08] bg-zinc-900/65 backdrop-blur ${statusColors[migration.status as keyof typeof statusColors]}`}
              >
                <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{statusIcons[migration.status as keyof typeof statusIcons]}</span>
                      <div>
                        <h3 className="text-lg font-semibold">{migration.name}</h3>
                        <p className="text-xs opacity-75 mt-1">
                          Créée: {new Date(migration.createdAt).toLocaleDateString('fr-FR')}
                        </p>
                      </div>
                    </div>
                  </div>
                  <span className="px-3 py-1 bg-white/50 rounded font-semibold text-sm">
                    {migration.status === 'pending' && 'En attente'}
                    {migration.status === 'running' && 'En cours'}
                    {migration.status === 'completed' && 'Terminée'}
                    {migration.status === 'failed' && 'Échouée'}
                  </span>
                </div>

                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">Progression</span>
                    <span className="text-sm font-semibold">{migration.progress}%</span>
                  </div>
                  <Progress value={migration.progress} />
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm mb-4">
                  <div>
                    <span className="opacity-75">Source:</span>
                    <p className="font-mono text-xs">{migration.sourceNode?.name ?? migration.sourceNodeId ?? '—'}</p>
                    {migration.sourcePath && <p className="font-mono text-[11px] opacity-75 break-all">{migration.sourcePath}</p>}
                  </div>
                  <div>
                    <span className="opacity-75">Destination:</span>
                    <p className="font-mono text-xs">{migration.targetNode?.name ?? migration.targetNodeId ?? '—'}</p>
                    {migration.targetPath && <p className="font-mono text-[11px] opacity-75 break-all">{migration.targetPath}</p>}
                  </div>
                </div>

                {migration.status === 'pending' && (
                  <Button
                    onClick={() => startMigration(migration.id)}
                    className="w-full gap-2 bg-violet-600 text-white hover:bg-violet-500"
                  >
                    <PlayCircle className="w-4 h-4" />
                    Démarrer la Migration
                  </Button>
                )}

                {migration.status === 'running' && (
                  <div className="px-4 py-2 bg-white/30 text-center rounded-lg font-medium flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Migration en cours…
                  </div>
                )}

                {migration.status === 'completed' && (
                  <div className="px-4 py-2 bg-white/30 text-center rounded-lg font-medium flex items-center justify-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    Migration terminée avec succès
                  </div>
                )}

                {migration.status === 'failed' && (
                  <div className="px-4 py-2 bg-white/30 text-center rounded-lg font-medium">
                    Migration échouée - Veuillez réessayer
                  </div>
                )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Wizard */}
      {wizardOpen && (
        <WizardDialog
          title="Créer une nouvelle migration"
          description="Guide pas à pas pour configurer une migration sécurisée"
          steps={wizardSteps}
          onComplete={createMigration}
          onCancel={() => setWizardOpen(false)}
          completeButtonLabel="Créer la migration"
        />
      )}
    </DashboardLayout>
  );
}
