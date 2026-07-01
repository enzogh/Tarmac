'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, CheckCircle2, AlertCircle, Loader2, Play } from 'lucide-react';
import { api, MountItem, NodeItem } from '../../../lib/api';
import { DashboardLayout } from '../../../components/DashboardLayout';
import { Badge } from '../../../components/ui';
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

const NFS_PRESETS: PresetOption[] = [
  {
    id: 'home-backup',
    name: 'Sauvegarde Locale',
    description: 'Monter un répertoire local pour la sauvegarde',
    icon: '💾',
    config: {
      fsType: 'nfs4',
      mountOptions: 'defaults,hard,intr',
      targetPath: '/mnt/backup',
    },
  },
  {
    id: 'media-share',
    name: 'Partage Média',
    description: 'Configuration optimisée pour les fichiers multimédias',
    icon: '🎬',
    config: {
      fsType: 'nfs4',
      mountOptions: 'defaults,hard,intr,noatime',
      targetPath: '/mnt/media',
    },
  },
  {
    id: 'fast-cache',
    name: 'Cache Rapide',
    description: 'Optimisé pour les performances (SSD)',
    icon: '⚡',
    config: {
      fsType: 'nfs4',
      mountOptions: 'defaults,hard,intr,noatime,actimeo=60',
      targetPath: '/mnt/cache',
    },
  },
  {
    id: 'archive',
    name: 'Archive Froide',
    description: 'Configuration pour accès occasionnel',
    icon: '📦',
    config: {
      fsType: 'nfs4',
      mountOptions: 'defaults,soft,timeo=300',
      targetPath: '/mnt/archive',
    },
  },
];

export default function MountsPage() {
  const router = useRouter();
  const token = useMemo(() => (typeof window !== 'undefined' ? localStorage.getItem('tarmac_token') : null), []);

  const [mounts, setMounts] = useState<MountItem[]>([]);
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<PresetOption | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    sourcePath: '',
    additionalSources: [] as string[],
    targetPath: '/mnt',
    fsType: 'nfs4',
    mountOptions: 'defaults,hard,intr',
    nodeId: '',
  });

  const load = async () => {
    if (!token) return;
    try {
      const [m, n] = await Promise.all([
        api.mounts.list(token),
        api.nodes.list(token),
      ]);
      setMounts(m);
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
      title: 'Choisir un modèle',
      description: 'Sélectionnez le type de montage qui correspond à votre cas',
      content: (
        <div>
          <PresetSelector
            presets={NFS_PRESETS}
            onSelect={(preset) => {
              setSelectedPreset(preset);
              if (preset.config) {
                setFormData((prev) => ({ ...prev, ...preset.config }));
              }
            }}
          />
          {selectedPreset && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded text-sm text-green-900">
              ✓ Modèle sélectionné: <strong>{selectedPreset.name}</strong>
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'source-target',
      title: 'Chemins Source et Destination',
      description: 'Indiquez d\'où proviennent les données et où les monter',
      content: (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Nom du montage
              <HelpText text="Donnez un nom descriptif à ce montage (ex: backup-db, media-store)" />
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="ex: backup-mensuel"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Chemin source
              <HelpText text="Exemple: /home/user/data ou nfs://server/share" />
            </label>
            <input
              type="text"
              value={formData.sourcePath}
              onChange={(e) => setFormData({ ...formData, sourcePath: e.target.value })}
              placeholder="ex: /data/backup"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Chemin destination sur le serveur
              <HelpText text="Où monter le partage (ex: /mnt/backup, /mnt/media)" />
            </label>
            <input
              type="text"
              value={formData.targetPath}
              onChange={(e) => setFormData({ ...formData, targetPath: e.target.value })}
              placeholder="ex: /mnt/backup"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Serveur destination
              <HelpText text="Sélectionnez le nœud où sera monté le partage" />
            </label>
            <select
              value={formData.nodeId}
              onChange={(e) => setFormData({ ...formData, nodeId: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">-- Choisir un serveur --</option>
              {nodes.map((node) => (
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
      id: 'performance',
      title: 'Options de Performance',
      description: 'Configurez les paramètres réseau et mise en cache',
      content: (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Type de système de fichiers
              <HelpText text="NFS4 est recommandé. NFS3 est compatible mais moins sûr." />
            </label>
            <select
              value={formData.fsType}
              onChange={(e) => setFormData({ ...formData, fsType: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="nfs4">NFS 4 (Recommandé)</option>
              <option value="nfs3">NFS 3</option>
              <option value="nfs">NFS (Auto)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Options de montage
              <HelpText text="Paramètres avancés NFS. Conservez la valeur par défaut si vous n'êtes pas sûr." />
            </label>
            <textarea
              value={formData.mountOptions}
              onChange={(e) => setFormData({ ...formData, mountOptions: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-600 mt-2">
              <strong>defaults:</strong> options de base
              <br />
              <strong>hard:</strong> attendez le serveur si indisponible
              <br />
              <strong>intr:</strong> interruptible par signal
            </p>
          </div>
        </div>
      ),
    },
    {
      id: 'review',
      title: 'Vérification Finale',
      description: 'Vérifiez vos paramètres avant de créer le montage',
      content: (
        <div className="space-y-4">
          <OperationPreview
            steps={[
              {
                id: 'validate',
                title: 'Validation des paramètres',
                description: 'Vérification de la connectivité et des chemins',
              },
              {
                id: 'setup',
                title: 'Configuration du montage NFS',
                description: 'Création du répertoire et montage du partage',
              },
              {
                id: 'verify',
                title: 'Vérification et test',
                description: 'Test du montage et enregistrement',
              },
            ]}
          />

          <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Nom:</span>
              <span className="font-mono">{formData.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Source:</span>
              <span className="font-mono">{formData.sourcePath}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Destination:</span>
              <span className="font-mono">{formData.targetPath}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Serveur:</span>
              <span className="font-mono">{nodes.find((n) => n.id === formData.nodeId)?.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Type FS:</span>
              <span className="font-mono">{formData.fsType}</span>
            </div>
          </div>

          <InfoBox type="info" title="Prêt à continuer?">
            Cliquez sur "Créer le montage" pour appliquer ces paramètres. L'opération prendra quelques secondes.
          </InfoBox>
        </div>
      ),
    },
  ];

  const createMount = async () => {
    if (!token) return;
    try {
      await api.mounts.create(token, {
        name: formData.name,
        sourcePath: formData.sourcePath,
        additionalSources: formData.additionalSources,
        targetPath: formData.targetPath,
        fsType: formData.fsType,
        mountOptions: formData.mountOptions,
        nodeId: formData.nodeId || undefined,
      });
      setWizardOpen(false);
      setFormData({
        name: '',
        sourcePath: '',
        additionalSources: [],
        targetPath: '/mnt',
        fsType: 'nfs4',
        mountOptions: 'defaults,hard,intr',
        nodeId: '',
      });
      setSelectedPreset(null);
      await load();
    } catch (error) {
      alert('Erreur lors de la création du montage');
    }
  };

  const statusColors = {
    pending: 'bg-yellow-500 text-white',
    active: 'bg-green-500 text-white',
    error: 'bg-red-500 text-white',
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Montages Réseau</h1>
            <p className="text-gray-600 mt-1">Gérez les montages NFS et les partages réseau</p>
          </div>
          <button
            onClick={() => setWizardOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold"
          >
            <Plus className="w-5 h-5" />
            Nouveau Montage
          </button>
        </div>

        {/* Info Box */}
        <InfoBox type="info" title="À propos des montages NFS">
          Les montages NFS permettent de partager des répertoires entre les serveurs à travers le réseau VLAN. Utilisez le
          guide ci-dessous pour configurer facilement vos partages.
        </InfoBox>

        {/* Mounts List */}
        {mounts.length === 0 ? (
          <Card>
            <CardContent className="pt-12 pb-12 text-center">
              <div className="text-6xl mb-4">📂</div>
              <p className="text-gray-600 font-medium">Aucun montage configuré</p>
              <p className="text-sm text-gray-500 mt-2">Créez votre premier montage NFS en cliquant sur "Nouveau Montage"</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {mounts.map((mount) => (
              <Card key={mount.id}>
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <h3 className="text-lg font-semibold text-gray-900">{mount.name}</h3>
                        <div className={`px-2 py-1 rounded text-white text-sm font-semibold ${statusColors[mount.status as keyof typeof statusColors]}`}>
                          {mount.status === 'active' && '✓ Actif'}
                          {mount.status === 'pending' && '⏳ En attente'}
                          {mount.status === 'error' && '✗ Erreur'}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4 mt-3 text-sm text-gray-600">
                        <div>
                          <span className="text-gray-500">Source:</span>
                          <p className="font-mono">{mount.sourcePath}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Destination:</span>
                          <p className="font-mono">{mount.targetPath}</p>
                        </div>
                        {mount.additionalSources.length > 0 && (
                          <div className="col-span-2">
                            <span className="text-gray-500">Sources additionnelles:</span>
                            <p className="font-mono text-xs">{mount.additionalSources.join(', ')}</p>
                          </div>
                        )}
                      </div>
                    </div>
                    <button
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                      onClick={() => alert('Suppression non implémentée')}
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
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
          title="Créer un nouveau montage NFS"
          description="Guide pas à pas pour configurer un montage réseau"
          steps={wizardSteps}
          onComplete={createMount}
          onCancel={() => setWizardOpen(false)}
          completeButtonLabel="Créer le montage"
        />
      )}
    </DashboardLayout>
  );
}
