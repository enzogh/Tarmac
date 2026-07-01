'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRightLeft, Plus, PlayCircle, Loader2, CheckCircle2, Trash2 } from 'lucide-react';
import { api, MigrationItem, NodeItem } from '../../../lib/api';
import { DashboardLayout } from '../../../components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Progress } from '../../../components/ui/progress';
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

  const [formData, setFormData] = useState({
    name: '',
    sourceNodeId: '',
    targetNodeId: '',
    reason: '',
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
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded text-sm text-green-900">
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
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Nom de la migration
              <HelpText text="Donnez un nom descriptif à cette tâche de migration" />
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="ex: Migration storage-1 vers storage-2"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Serveur Source
              <HelpText text="Le serveur dont vous migrez les données" />
            </label>
            <select
              value={formData.sourceNodeId}
              onChange={(e) => setFormData({ ...formData, sourceNodeId: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Serveur Destination
              <HelpText text="Le serveur qui recevra les données" />
            </label>
            <select
              value={formData.targetNodeId}
              onChange={(e) => setFormData({ ...formData, targetNodeId: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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

          <div className="bg-gray-50 rounded-lg p-4 space-y-3 text-sm">
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-600">Migration:</span>
              <span className="font-mono font-semibold">{formData.name}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-600">Source:</span>
              <span className="font-mono">{nodes.find((n) => n.id === formData.sourceNodeId)?.name}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-600">Destination:</span>
              <span className="font-mono">{nodes.find((n) => n.id === formData.targetNodeId)?.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Raison:</span>
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
    try {
      await api.migrations.create(token, {
        name: formData.name,
        sourceNodeId: formData.sourceNodeId || undefined,
        targetNodeId: formData.targetNodeId || undefined,
      });
      setWizardOpen(false);
      setFormData({
        name: '',
        sourceNodeId: '',
        targetNodeId: '',
        reason: '',
      });
      setSelectedPreset(null);
      await load();
    } catch (error) {
      alert('Erreur lors de la création de la migration');
    }
  };

  const startMigration = async (migrationId: string) => {
    if (!token) return;
    await api.migrations.start(token, migrationId);
    await load();
  };

  const statusIcons = {
    pending: '⏳',
    running: '▶️',
    completed: '✅',
    failed: '❌',
  };

  const statusColors = {
    pending: 'bg-yellow-50 border-yellow-200 text-yellow-900',
    running: 'bg-blue-50 border-blue-200 text-blue-900',
    completed: 'bg-green-50 border-green-200 text-green-900',
    failed: 'bg-red-50 border-red-200 text-red-900',
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Migrations de Données</h1>
            <p className="text-gray-600 mt-1">Déplacez vos données entre serveurs en toute sécurité</p>
          </div>
          <button
            onClick={() => setWizardOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold"
          >
            <Plus className="w-5 h-5" />
            Nouvelle Migration
          </button>
        </div>

        {/* Info Box */}
        <InfoBox type="info" title="À propos des migrations">
          Les migrations permettent de déplacer les données d'un serveur à l'autre de manière sécurisée et vérifiée. Cela
          est utile lors de maintenance, rééquilibrage de charge, ou décommissionnement d'un serveur.
        </InfoBox>

        {/* Migrations List */}
        {migrations.length === 0 ? (
          <Card>
            <CardContent className="pt-12 pb-12 text-center">
              <div className="text-6xl mb-4">📊</div>
              <p className="text-gray-600 font-medium">Aucune migration en cours</p>
              <p className="text-sm text-gray-500 mt-2">Cliquez sur "Nouvelle Migration" pour démarrer</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {migrations.map((migration) => (
              <div
                key={migration.id}
                className={`border-2 rounded-lg p-6 ${statusColors[migration.status as keyof typeof statusColors]}`}
              >
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
                    <p className="font-mono text-xs">nœud-source</p>
                  </div>
                  <div>
                    <span className="opacity-75">Destination:</span>
                    <p className="font-mono text-xs">nœud-destination</p>
                  </div>
                </div>

                {migration.status === 'pending' && (
                  <button
                    onClick={() => startMigration(migration.id)}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold flex items-center justify-center gap-2"
                  >
                    <PlayCircle className="w-4 h-4" />
                    Démarrer la Migration
                  </button>
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
              </div>
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
