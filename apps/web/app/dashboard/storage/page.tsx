'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  HardDrive,
  Shield,
  Zap,
  Grid3x3,
  AlertCircle,
  CheckCircle2,
  Database,
  Trash2,
  Crown,
  Copy,
  Layers,
  Server,
} from 'lucide-react';
import { api, NodeItem, PoolItem } from '../../../lib/api';
import { usePolling } from '../../../lib/hooks/usePolling';
import { DashboardLayout } from '../../../components/DashboardLayout';
import { PageHeader } from '../../../components/PageHeader';
import { Callout } from '../../../components/Callout';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Badge, NodeLabelBadges, StatCard } from '../../../components/ui';
import { CardListSkeleton, StatCardSkeleton } from '../../../components/ui/skeleton';
import { readNodeLabels } from '../../../lib/node-labels';
import { SectionLabel } from '../../../components/SectionLabel';
import {
  WizardDialog,
  PresetSelector,
  HelpText,
  InfoBox,
  PresetOption,
  StepConfig,
} from '../../../components/ui/wizard';

const POOL_PRESETS: PresetOption[] = [
  {
    id: 'mirror',
    name: 'Miroir',
    description: 'Chaque nœud garde une copie identique — redondance maximale',
    icon: '🪞',
    config: { strategy: 'mirror' },
  },
  {
    id: 'raid5',
    name: 'RAID 5',
    description: 'Répartition avec parité — bon équilibre redondance/performance',
    icon: '⚖️',
    config: { strategy: 'raid5' },
  },
  {
    id: 'raid6',
    name: 'RAID 6',
    description: 'Parité double — tolère la perte de deux nœuds',
    icon: '🛡️',
    config: { strategy: 'raid6' },
  },
  {
    id: 'single',
    name: 'Simple',
    description: 'Un seul nœud, sans redondance — capacité maximale',
    icon: '⚡',
    config: { strategy: 'single' },
  },
];

const STATUS_BADGE: Record<string, { label: string; type: 'success' | 'warning' | 'error' | 'info' }> = {
  active: { label: 'Actif', type: 'success' },
  pending: { label: 'En attente', type: 'warning' },
  error: { label: 'Erreur', type: 'error' },
};

export default function StoragePage() {
  const { data: nodes = [] } = usePolling('nodes', api.nodes.list);
  const { data: pools = [], mutate: refreshPools, isLoading: poolsLoading } = usePolling('pools', api.pools.list, { intervalMs: 20000 });
  const [wizardOpen, setWizardOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<PresetOption | null>(null);
  const [notice, setNotice] = useState<{ type: 'error' | 'success'; message: string } | null>(null);
  const [busyPoolId, setBusyPoolId] = useState<string | null>(null);
  const [nodeLabels, setNodeLabels] = useState<Record<string, string[]>>({});

  const [formData, setFormData] = useState({
    name: '',
    strategy: 'mirror',
    nodeIds: [] as string[],
  });

  useEffect(() => {
    setNodeLabels(readNodeLabels());
  }, []);

  const resetForm = () => {
    setFormData({ name: '', strategy: 'mirror', nodeIds: [] });
    setSelectedPreset(null);
  };

  const toggleNode = (nodeId: string) => {
    setFormData((prev) => ({
      ...prev,
      nodeIds: prev.nodeIds.includes(nodeId)
        ? prev.nodeIds.filter((id) => id !== nodeId)
        : [...prev.nodeIds, nodeId],
    }));
  };

  const wizardSteps: StepConfig[] = !wizardOpen ? [] : [
    {
      id: 'choose-strategy',
      title: 'Stratégie du pool',
      description: 'Choisissez comment les nœuds du pool se répartissent les données',
      content: (
        <div>
          <PresetSelector
            presets={POOL_PRESETS}
            selectedId={selectedPreset?.id}
            onSelect={(preset) => {
              setSelectedPreset(preset);
              if (preset.config) {
                setFormData((prev) => ({ ...prev, ...preset.config }));
              }
            }}
          />
        </div>
      ),
    },
    {
      id: 'select-nodes',
      title: 'Nom et nœuds',
      description: 'Nommez le pool et choisissez les nœuds qui en feront partie',
      content: (
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-200">
              Nom du pool
              <HelpText text="Identifiant unique pour ce pool de stockage" />
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="ex: pool-principal"
              className="w-full rounded-lg border border-white/[0.12] bg-zinc-950/70 px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-200">
              Nœuds membres
              <HelpText text="Le premier nœud sélectionné devient le nœud principal (primary), les autres sont ajoutés en replica." />
            </label>
            <div className="space-y-2">
              {nodes.map((node) => {
                const checked = formData.nodeIds.includes(node.id);
                const index = formData.nodeIds.indexOf(node.id);
                return (
                  <label
                    key={node.id}
                    className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 transition ${
                      checked ? 'border-violet-500/50 bg-violet-500/[0.08]' : 'border-white/[0.1] bg-zinc-950/50'
                    }`}
                  >
                    <span className="flex items-center gap-2 text-sm text-foreground">
                      <input type="checkbox" checked={checked} onChange={() => toggleNode(node.id)} className="h-4 w-4 rounded" />
                      {node.name}
                      <span className="text-xs text-muted-foreground">({node.status})</span>
                      <NodeLabelBadges labels={nodeLabels[node.id] ?? []} className="ml-2" />
                    </span>
                    {checked && (
                      <Badge label={index === 0 ? 'primary' : 'replica'} type={index === 0 ? 'info' : 'success'} />
                    )}
                  </label>
                );
              })}
              {nodes.length === 0 && (
                <p className="text-sm text-muted-foreground">Aucun nœud enregistré pour le moment.</p>
              )}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'review',
      title: 'Vérification',
      description: 'Confirmer la création du pool',
      content: (
        <div className="space-y-4">
          <div className="space-y-3 rounded-lg border border-white/[0.08] bg-zinc-900/60 p-4 text-sm">
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Pool :</span>
              <span className="font-mono font-semibold">{formData.name || '—'}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Stratégie :</span>
              <span className="font-mono">{selectedPreset?.name ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Nœuds :</span>
              <span className="font-mono">{formData.nodeIds.length}</span>
            </div>
          </div>

          <InfoBox type="info" title="Ce qui se passe ensuite">
            Le pool est créé immédiatement. Chaque nœud membre passe en attente puis actif dès que son agent confirme
            la configuration (au prochain cycle de réconciliation, ~15s).
          </InfoBox>
        </div>
      ),
    },
  ];

  const createPool = async () => {
    if (!formData.name.trim()) {
      setNotice({ type: 'error', message: 'Le nom du pool est obligatoire.' });
      return;
    }
    try {
      const pool = await api.pools.create({ name: formData.name.trim(), strategy: formData.strategy });
      await Promise.all(
        formData.nodeIds.map((nodeId, index) =>
          api.pools.addMember(pool.id, {
            nodeId,
            role: index === 0 ? 'primary' : 'replica',
            status: 'pending',
          }),
        ),
      );
      setNotice({ type: 'success', message: `Pool « ${pool.name} » créé.` });
      setWizardOpen(false);
      resetForm();
      await refreshPools();
    } catch {
      setNotice({ type: 'error', message: 'Erreur lors de la création du pool.' });
    }
  };

  const deletePool = async (pool: PoolItem) => {
    if (!window.confirm(`Supprimer le pool « ${pool.name} » ? Cette action est définitive.`)) return;
    setBusyPoolId(pool.id);
    try {
      await api.pools.delete(pool.id);
      await refreshPools();
    } catch {
      setNotice({ type: 'error', message: 'Erreur lors de la suppression du pool.' });
    } finally {
      setBusyPoolId(null);
    }
  };

  const removeMember = async (poolId: string, nodeId: string) => {
    setBusyPoolId(poolId);
    try {
      await api.pools.removeMember(poolId, nodeId);
      await refreshPools();
    } catch {
      setNotice({ type: 'error', message: "Erreur lors du retrait du nœud." });
    } finally {
      setBusyPoolId(null);
    }
  };

  const nodeName = (nodeId: string) => nodes.find((n) => n.id === nodeId)?.name ?? nodeId;
  const activePools = pools.filter((pool) => pool.status === 'active').length;
  const nodesInPools = new Set(pools.flatMap((pool) => pool.members.map((member) => member.nodeId))).size;

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
          icon={Database}
          title="Stockage"
          description="Regroupez des nœuds en pools selon une stratégie de redondance."
          actions={
            <Button onClick={() => setWizardOpen(true)} className="gap-2 bg-violet-600 text-white hover:bg-violet-500">
              <Plus className="w-5 h-5" />
              Nouveau pool
            </Button>
          }
        />

        <section className="space-y-4">
          <SectionLabel>Aperçu</SectionLabel>
          {poolsLoading ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3 animate-fade-in">
              <StatCard label="Pools" value={pools.length} icon={<Layers className="h-8 w-8" />} changeType="neutral" />
              <StatCard
                label="Pools actifs"
                value={activePools}
                icon={<Grid3x3 className="h-8 w-8" />}
                changeType={activePools === pools.length && pools.length > 0 ? 'up' : 'neutral'}
              />
              <StatCard label="Nœuds regroupés" value={nodesInPools} icon={<Server className="h-8 w-8" />} changeType="neutral" />
            </div>
          )}
        </section>

        <section className="space-y-4">
          <SectionLabel>Stratégies</SectionLabel>
          <Callout variant="info">
            Un pool regroupe des nœuds sous une stratégie logique (miroir, RAID, simple). Le statut passe à
            «&nbsp;actif&nbsp;» dès que l'agent de chaque nœud membre confirme la configuration.
          </Callout>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="w-5 h-5 text-red-500" />
                  Redondance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Miroir, RAID 5, RAID 6 : protègent contre la perte d'un ou plusieurs nœuds membres.
                </p>
              </CardContent>
            </Card>

            <Card className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-yellow-500" />
                  Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Simple : aucun nœud de secours, capacité et débit maximaux.
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        <SectionLabel>Pools</SectionLabel>
        {poolsLoading ? (
          <CardListSkeleton cards={2} />
        ) : pools.length === 0 ? (
          <Card className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
            <CardContent className="pt-12 pb-12 text-center">
              <HardDrive className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
              <p className="font-medium text-muted-foreground">Aucun pool créé</p>
              <p className="mt-2 text-sm text-muted-foreground">Cliquez sur « Nouveau pool » pour en créer un.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 animate-fade-in">
            {pools.map((pool) => {
              const statusBadge = STATUS_BADGE[pool.status] ?? STATUS_BADGE.pending;
              return (
                <Card key={pool.id} className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="flex items-center gap-2">
                        <Grid3x3 className="w-5 h-5 text-violet-400" />
                        {pool.name}
                      </CardTitle>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge label={pool.strategy} type="info" />
                        <Badge label={statusBadge.label} type={statusBadge.type} />
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busyPoolId === pool.id}
                          onClick={() => deletePool(pool)}
                          className="text-rose-300 hover:text-rose-200"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Supprimer
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {pool.members.length === 0 && (
                      <p className="text-sm text-muted-foreground">Aucun nœud membre pour ce pool.</p>
                    )}
                    {pool.members.map((member) => {
                      const memberStatus = STATUS_BADGE[member.status] ?? STATUS_BADGE.pending;
                      return (
                        <div
                          key={member.nodeId}
                          className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm"
                        >
                          <span className="flex items-center gap-2">
                            {member.role === 'primary' ? (
                              <Crown className="h-3.5 w-3.5 text-amber-400" />
                            ) : (
                              <Copy className="h-3.5 w-3.5 text-sky-400" />
                            )}
                            {nodeName(member.nodeId)}
                            <span className="text-xs text-muted-foreground">({member.role})</span>
                          </span>
                          <div className="flex items-center gap-2">
                            <Badge label={memberStatus.label} type={memberStatus.type} />
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busyPoolId === pool.id}
                              onClick={() => removeMember(pool.id, member.nodeId)}
                              className="text-rose-300 hover:text-rose-200"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {wizardOpen && (
        <WizardDialog
          title="Créer un nouveau pool de stockage"
          description="Guide pas à pas pour regrouper des nœuds"
          steps={wizardSteps}
          onComplete={createPool}
          onCancel={() => {
            setWizardOpen(false);
            resetForm();
          }}
          completeButtonLabel="Créer le pool"
        />
      )}
    </DashboardLayout>
  );
}
