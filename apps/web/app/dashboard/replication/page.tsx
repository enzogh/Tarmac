'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Copy, Zap, Shield, AlertCircle, CheckCircle2 } from 'lucide-react';
import { api, NodeItem } from '../../../lib/api';
import { DashboardLayout } from '../../../components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import {
  WizardDialog,
  PresetSelector,
  AdvancedOptions,
  OperationPreview,
  HelpText,
  InfoBox,
  PresetOption,
  StepConfig,
} from '../../../components/ui/wizard';

const REPLICATION_PRESETS: PresetOption[] = [
  {
    id: 'mirror',
    name: 'Miroir Synchrone',
    description: 'Réplication synchrone (writes attend la confirmation)',
    icon: '🪞',
    config: {
      strategy: 'mirror',
      mode: 'sync',
      copies: 2,
    },
  },
  {
    id: 'distributed',
    name: 'Réplication Distribuée',
    description: 'Copies distribuées sur 3 nœuds (haute disponibilité)',
    icon: '🌐',
    config: {
      strategy: 'distributed',
      mode: 'async',
      copies: 3,
    },
  },
  {
    id: 'backup',
    name: 'Sauvegarde Asynchrone',
    description: 'Copie de secours asynchrone (performance optimale)',
    icon: '💾',
    config: {
      strategy: 'backup',
      mode: 'async',
      copies: 1,
    },
  },
  {
    id: 'geo-redundant',
    name: 'Géo-Redondance',
    description: 'Réplication multi-site pour la continuité d\'activité',
    icon: '🗺️',
    config: {
      strategy: 'geo-redundant',
      mode: 'async',
      copies: 2,
    },
  },
];

export default function ReplicationPage() {
  const router = useRouter();
  const token = useMemo(() => (typeof window !== 'undefined' ? localStorage.getItem('tarmac_token') : null), []);

  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [replications, setReplications] = useState<any[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<PresetOption | null>(null);
  const [notice, setNotice] = useState<{ type: 'error' | 'success'; message: string } | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    sourceNodeId: '',
    replicaNodeIds: [] as string[],
    strategy: 'mirror',
    mode: 'sync',
    retentionDays: 30,
  });

  const load = async () => {
    if (!token) return;
    try {
      const n = await api.nodes.list(token);
      setNodes(n);
      // TODO: Load replications when API endpoint available
      setReplications([]);
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

  const wizardSteps: StepConfig[] = [
    {
      id: 'choose-preset',
      title: 'Stratégie de Réplication',
      description: 'Sélectionnez la stratégie adapée à vos besoins',
      content: (
        <div>
          <PresetSelector
            presets={REPLICATION_PRESETS}
            selectedId={selectedPreset?.id}
            onSelect={(preset) => {
              setSelectedPreset(preset);
              if (preset.config) {
                setFormData((prev) => ({ ...prev, ...preset.config }));
              }
            }}
          />
          {selectedPreset && (
            <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.08] p-3 text-sm text-emerald-100">
              ✓ Stratégie: <strong>{selectedPreset.name}</strong>
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'select-nodes',
      title: 'Sélection des Nœuds',
      description: 'Choisissez le nœud source et les replicas',
      content: (
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-200">
              Nom de la réplication
              <HelpText text="Identifiant pour cette tâche de réplication" />
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="ex: Réplication-pool-1"
              className="w-full rounded-lg border border-white/[0.12] bg-zinc-950/70 px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-200">
              Nœud Source
              <HelpText text="Le nœud qui sera répliqué" />
            </label>
            <select
              value={formData.sourceNodeId}
              onChange={(e) => setFormData({ ...formData, sourceNodeId: e.target.value })}
              className="w-full rounded-lg border border-white/[0.12] bg-zinc-950/70 px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              <option value="">-- Choisir un nœud source --</option>
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name} ({node.status})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-200">
              Nœuds Replicas
              <HelpText text="Nœuds qui recevront les copies (Ctrl+Click pour en sélectionner plusieurs)" />
            </label>
            <select
              multiple
              size={4}
              value={formData.replicaNodeIds}
              onChange={(e) => {
                const selected = Array.from(e.target.selectedOptions, (opt) => opt.value);
                setFormData({ ...formData, replicaNodeIds: selected });
              }}
              className="w-full rounded-lg border border-white/[0.12] bg-zinc-950/70 px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              {nodes
                .filter((n) => n.id !== formData.sourceNodeId)
                .map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name}
                  </option>
                ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">Sélectionné: {formData.replicaNodeIds.length} nœud(s)</p>
          </div>
        </div>
      ),
    },
    {
      id: 'advanced',
      title: 'Options Avancées',
      description: 'Configurez les paramètres de performance et de rétention',
      content: (
        <div className="space-y-4">
          <AdvancedOptions>
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-200">
                  Mode de Réplication
                  <HelpText text="Synchrone = attendre confirmation; Asynchrone = plus rapide mais moins sûr" />
                </label>
                <select
                  value={formData.mode}
                  onChange={(e) => setFormData({ ...formData, mode: e.target.value })}
                  className="w-full rounded-lg border border-white/[0.12] bg-zinc-950/70 px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  <option value="sync">Synchrone (Sûr, plus lent)</option>
                  <option value="async">Asynchrone (Rapide, moins sûr)</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-200">
                  Rétention des Replicas (jours)
                  <HelpText text="Combien de temps conserver les copies" />
                </label>
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={formData.retentionDays}
                  onChange={(e) => setFormData({ ...formData, retentionDays: parseInt(e.target.value) })}
                  className="w-full rounded-lg border border-white/[0.12] bg-zinc-950/70 px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
            </div>
          </AdvancedOptions>
        </div>
      ),
    },
    {
      id: 'review',
      title: 'Vérification Finale',
      description: 'Confirmer la configuration avant activation',
      content: (
        <div className="space-y-4">
          <OperationPreview
            steps={[
              {
                id: 'validate',
                title: 'Validation des nœuds',
                description: 'Vérification de la connectivité VLAN',
              },
              {
                id: 'sync',
                title: 'Synchronisation initiale',
                description: 'Copie des données vers les replicas',
              },
              {
                id: 'configure',
                title: 'Configuration réplication',
                description: 'Activation du mirror/réplication continu',
              },
              {
                id: 'monitor',
                title: 'Démarrage du monitoring',
                description: 'Surveillance de la cohérence des copies',
              },
            ]}
          />

          <div className="space-y-3 rounded-lg border border-white/[0.08] bg-zinc-900/60 p-4 text-sm">
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Stratégie:</span>
              <span className="font-mono font-semibold">{selectedPreset?.name}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Source:</span>
              <span className="font-mono">{nodes.find((n) => n.id === formData.sourceNodeId)?.name}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Replicas:</span>
              <span className="font-mono">{formData.replicaNodeIds.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Mode:</span>
              <span className="font-mono">{formData.mode === 'sync' ? 'Synchrone' : 'Asynchrone'}</span>
            </div>
          </div>

          <InfoBox type="info" title="Important">
            La réplication commence immédiatement après confirmation. Les données source continueront à être mises à jour normalement.
          </InfoBox>
        </div>
      ),
    },
  ];

  const createReplication = async () => {
    if (!token) return;
    try {
      // TODO: Call API endpoint when available
      // await api.replications.create(token, formData);
      setNotice({ type: 'success', message: 'Réplication créée (endpoint à implémenter).' });
      setWizardOpen(false);
      setFormData({
        name: '',
        sourceNodeId: '',
        replicaNodeIds: [],
        strategy: 'mirror',
        mode: 'sync',
        retentionDays: 30,
      });
      setSelectedPreset(null);
    } catch (error) {
      setNotice({ type: 'error', message: 'Erreur lors de la création de la réplication.' });
    }
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
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Réplication de Données</h1>
            <p className="mt-1 text-sm text-muted-foreground">Configurez la réplication pour la haute disponibilité et la continuité.</p>
          </div>
          <Button
            onClick={() => setWizardOpen(true)}
            className="gap-2 bg-violet-600 text-white hover:bg-violet-500"
          >
            <Plus className="w-5 h-5" />
            Nouvelle Réplication
          </Button>
        </div>

        {/* Info Box */}
        <InfoBox type="info" title="À propos de la réplication">
          La réplication crée automatiquement des copies de vos données sur d'autres nœuds. Cela améliore la disponibilité et
          offre une protection contre la perte de données.
        </InfoBox>

        {/* Strategy Overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-red-500" />
                Synchrone (Sûr)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Chaque écriture attend la confirmation de tous les replicas. Maximum de sécurité, performances réduites.
              </p>
            </CardContent>
          </Card>

          <Card className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-yellow-500" />
                Asynchrone (Rapide)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Les écritures se font d'abord localement, puis répliquées. Meilleures performances, cohérence éventuelle.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Active Replications */}
        {replications.length === 0 ? (
          <Card className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
            <CardContent className="pt-12 pb-12 text-center">
              <div className="text-6xl mb-4">📋</div>
              <p className="font-medium text-muted-foreground">Aucune réplication active</p>
              <p className="mt-2 text-sm text-muted-foreground">Cliquez sur "Nouvelle Réplication" pour en créer une.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {replications.map((rep: any) => (
              <Card key={rep.id} className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Copy className="w-5 h-5" />
                    {rep.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  Stratégie: {rep.strategy} | Mode: {rep.mode} | Replicas: {rep.replicaCount}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Wizard */}
      {wizardOpen && (
        <WizardDialog
          title="Configurer une nouvelle réplication"
          description="Guide pas à pas pour la réplication sécurisée"
          steps={wizardSteps}
          onComplete={createReplication}
          onCancel={() => setWizardOpen(false)}
          completeButtonLabel="Créer la réplication"
        />
      )}
    </DashboardLayout>
  );
}
