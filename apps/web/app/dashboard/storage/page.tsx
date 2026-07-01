'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, HardDrive, Zap, Shield, Grid3x3 } from 'lucide-react';
import { api, NodeItem } from '../../../lib/api';
import { DashboardLayout } from '../../../components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
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

const POOL_PRESETS: PresetOption[] = [
  {
    id: 'raid1',
    name: 'RAID 1 (Mirroir)',
    description: 'Deux disques en mirroir - redondance maximale',
    icon: '🪞',
    config: {
      raidLevel: 'raid1',
      minDisks: 2,
      redundancy: 'high',
      speed: 'medium',
    },
  },
  {
    id: 'raid5',
    name: 'RAID 5 (Stripping + Parité)',
    description: 'Equilibre redondance/performance avec parité (3-4 disques)',
    icon: '⚖️',
    config: {
      raidLevel: 'raid5',
      minDisks: 3,
      redundancy: 'high',
      speed: 'fast',
    },
  },
  {
    id: 'raid6',
    name: 'RAID 6 (Double Parité)',
    description: 'RAID 5 amélioré - tolère 2 défaillances (4-5 disques)',
    icon: '🛡️',
    config: {
      raidLevel: 'raid6',
      minDisks: 4,
      redundancy: 'very-high',
      speed: 'medium-fast',
    },
  },
  {
    id: 'simple',
    name: 'Simple (Aucune Redondance)',
    description: 'Pool simple sans protection - performance maximale',
    icon: '⚡',
    config: {
      raidLevel: 'simple',
      minDisks: 1,
      redundancy: 'none',
      speed: 'ultra-fast',
    },
  },
];

export default function StoragePage() {
  const router = useRouter();
  const token = useMemo(() => (typeof window !== 'undefined' ? localStorage.getItem('tarmac_token') : null), []);

  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [pools, setPools] = useState<any[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<PresetOption | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    nodeId: '',
    diskPaths: [] as string[],
    raidLevel: 'raid1',
    redundancy: 'high',
    cacheEnabled: true,
    compression: true,
  });

  const load = async () => {
    if (!token) return;
    try {
      const [n, p] = await Promise.all([
        api.nodes.list(token),
        api.pools.list(token),
      ]);
      setNodes(n);
      setPools(p);
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
      title: 'Stratégie de Pool',
      description: 'Sélectionnez la configuration RAID adaptée',
      content: (
        <div>
          <PresetSelector
            presets={POOL_PRESETS}
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
      id: 'select-disks',
      title: 'Sélection des Disques',
      description: 'Choisissez le nœud et les disques pour le pool',
      content: (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Nom du Pool
              <HelpText text="Identifiant unique pour ce pool de stockage" />
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="ex: pool-principal"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Nœud Hôte
              <HelpText text="Le serveur qui hébergera ce pool" />
            </label>
            <select
              value={formData.nodeId}
              onChange={(e) => setFormData({ ...formData, nodeId: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">-- Choisir un nœud --</option>
              {nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name} ({node.status})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Chemins des Disques
              <HelpText text={`Entrez les chemins (ex: /dev/sda), minimum ${selectedPreset?.config?.minDisks || 1} disque(s)`} />
            </label>
            <textarea
              value={formData.diskPaths.join('\n')}
              onChange={(e) => setFormData({ ...formData, diskPaths: e.target.value.split('\n').filter(Boolean) })}
              placeholder="/dev/sda&#10;/dev/sdb&#10;/dev/sdc"
              rows={5}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-xs"
            />
            <p className="text-xs text-gray-500 mt-1">
              {formData.diskPaths.length} disque(s) - {selectedPreset?.config?.minDisks ? `Min: ${selectedPreset.config?.minDisks}` : ''}
            </p>
          </div>
        </div>
      ),
    },
    {
      id: 'advanced',
      title: 'Options de Performance',
      description: 'Configurez le cache et la compression',
      content: (
        <div className="space-y-4">
          <AdvancedOptions>
            <div className="space-y-4">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={formData.cacheEnabled}
                  onChange={(e) => setFormData({ ...formData, cacheEnabled: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
                <div>
                  <span className="font-medium text-gray-700">Activer le Cache</span>
                  <p className="text-xs text-gray-500">Les données fréquemment accédées sont cachées en mémoire</p>
                </div>
              </label>

              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={formData.compression}
                  onChange={(e) => setFormData({ ...formData, compression: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
                <div>
                  <span className="font-medium text-gray-700">Compression</span>
                  <p className="text-xs text-gray-500">Réduire la taille des données stockées</p>
                </div>
              </label>
            </div>
          </AdvancedOptions>
        </div>
      ),
    },
    {
      id: 'review',
      title: 'Vérification Finale',
      description: 'Confirmer la création du pool',
      content: (
        <div className="space-y-4">
          <OperationPreview
            steps={[
              {
                id: 'validate',
                title: 'Validation des disques',
                description: 'Vérification de l\'accès et de la santé des disques',
              },
              {
                id: 'format',
                title: 'Formatage',
                description: 'Préparation des disques pour le RAID',
              },
              {
                id: 'create',
                title: 'Création du pool',
                description: `Initialisation du ${selectedPreset?.name}`,
              },
              {
                id: 'mount',
                title: 'Montage',
                description: 'Intégration au système de fichiers',
              },
            ]}
          />

          <div className="bg-gray-50 rounded-lg p-4 space-y-3 text-sm">
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-600">Pool:</span>
              <span className="font-mono font-semibold">{formData.name}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-600">Stratégie:</span>
              <span className="font-mono">{selectedPreset?.name}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-600">Disques:</span>
              <span className="font-mono">{formData.diskPaths.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Options:</span>
              <span className="font-mono">
                {[formData.cacheEnabled && 'Cache', formData.compression && 'Compression'].filter(Boolean).join(', ')}
              </span>
            </div>
          </div>

          <InfoBox type="warning" title="⚠️ Attention">
            Cette opération formatera les disques spécifiés. Les données existantes seront perdues. Assurez-vous d'avoir
            sauvegardé vos données.
          </InfoBox>
        </div>
      ),
    },
  ];

  const createPool = async () => {
    if (!token) return;
    try {
      // TODO: Call API endpoint when available
      // await api.pools.create(token, formData);
      alert('Pool créé (endpoint à implémenter)');
      setWizardOpen(false);
      setFormData({
        name: '',
        nodeId: '',
        diskPaths: [],
        raidLevel: 'raid1',
        redundancy: 'high',
        cacheEnabled: true,
        compression: true,
      });
      setSelectedPreset(null);
    } catch (error) {
      alert('Erreur lors de la création du pool');
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Pools de Stockage</h1>
            <p className="text-gray-600 mt-1">Gérez vos pools de stockage et configurations RAID</p>
          </div>
          <button
            onClick={() => setWizardOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold"
          >
            <Plus className="w-5 h-5" />
            Nouveau Pool
          </button>
        </div>

        {/* Info Box */}
        <InfoBox type="info" title="À propos des pools">
          Un pool de stockage est un ensemble de disques configurés en RAID. Choisissez une stratégie adaptée à vos besoins
          de performance et de redondance.
        </InfoBox>

        {/* RAID Strategies Overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-red-500" />
                Redondance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">
                RAID 1, 5, 6: Protection contre la perte de disques. Plus la redondance est élevée, plus on tolère de
                défaillances.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-yellow-500" />
                Performance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600">
                RAID 0 (simple): Performance maximale, 0 redondance. RAID 5/6: Bon compromis entre sécurité et vitesse.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Existing Pools */}
        {pools.length === 0 ? (
          <Card>
            <CardContent className="pt-12 pb-12 text-center">
              <div className="text-6xl mb-4">💾</div>
              <p className="text-gray-600 font-medium">Aucun pool créé</p>
              <p className="text-sm text-gray-500 mt-2">Cliquez sur "Nouveau Pool" pour en créer un</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {pools.map((pool: any) => (
              <Card key={pool.id}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Grid3x3 className="w-5 h-5" />
                    {pool.name}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-gray-600">Type</p>
                      <p className="font-mono font-semibold">{pool.raidLevel?.toUpperCase()}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Disques</p>
                      <p className="font-mono font-semibold">{pool.diskCount}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Capacité</p>
                      <p className="font-mono font-semibold">{pool.capacityGb} GB</p>
                    </div>
                    <div>
                      <p className="text-gray-600">État</p>
                      <p className="font-mono font-semibold">{pool.status}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Wizard */}
      {wizardOpen && (
        <WizardDialog
          title="Créer un nouveau pool de stockage"
          description="Guide pas à pas pour configurer votre stockage"
          steps={wizardSteps}
          onComplete={createPool}
          onCancel={() => setWizardOpen(false)}
          completeButtonLabel="Créer le pool"
        />
      )}
    </DashboardLayout>
  );
}
