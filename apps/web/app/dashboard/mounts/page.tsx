'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, CheckCircle2, AlertCircle, Loader2, Play } from 'lucide-react';
import { api, MountItem, NodeItem } from '../../../lib/api';
import { DashboardLayout } from '../../../components/DashboardLayout';
import { Badge } from '../../../components/ui';
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
  const [notice, setNotice] = useState<{ type: 'error' | 'success' | 'warning'; message: string } | null>(null);

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
            <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.08] p-3 text-sm text-emerald-100">
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
            <label className="mb-2 block text-sm font-medium text-zinc-200">
              Nom du montage
              <HelpText text="Donnez un nom descriptif à ce montage (ex: backup-db, media-store)" />
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="ex: backup-mensuel"
              className="w-full rounded-lg border border-white/[0.12] bg-zinc-950/70 px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-200">
              Chemin source
              <HelpText text="Exemple: /home/user/data ou nfs://server/share" />
            </label>
            <input
              type="text"
              value={formData.sourcePath}
              onChange={(e) => setFormData({ ...formData, sourcePath: e.target.value })}
              placeholder="ex: /data/backup"
              className="w-full rounded-lg border border-white/[0.12] bg-zinc-950/70 px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-200">
              Chemin destination sur le serveur
              <HelpText text="Où monter le partage (ex: /mnt/backup, /mnt/media)" />
            </label>
            <input
              type="text"
              value={formData.targetPath}
              onChange={(e) => setFormData({ ...formData, targetPath: e.target.value })}
              placeholder="ex: /mnt/backup"
              className="w-full rounded-lg border border-white/[0.12] bg-zinc-950/70 px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-200">
              Serveur destination
              <HelpText text="Sélectionnez le nœud où sera monté le partage" />
            </label>
            <select
              value={formData.nodeId}
              onChange={(e) => setFormData({ ...formData, nodeId: e.target.value })}
              className="w-full rounded-lg border border-white/[0.12] bg-zinc-950/70 px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
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
            <label className="mb-2 block text-sm font-medium text-zinc-200">
              Type de système de fichiers
              <HelpText text="NFS4 est recommandé. NFS3 est compatible mais moins sûr." />
            </label>
            <select
              value={formData.fsType}
              onChange={(e) => setFormData({ ...formData, fsType: e.target.value })}
              className="w-full rounded-lg border border-white/[0.12] bg-zinc-950/70 px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
            >
              <option value="nfs4">NFS 4 (Recommandé)</option>
              <option value="nfs3">NFS 3</option>
              <option value="nfs">NFS (Auto)</option>
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-zinc-200">
              Options de montage
              <HelpText text="Paramètres avancés NFS. Conservez la valeur par défaut si vous n'êtes pas sûr." />
            </label>
            <textarea
              value={formData.mountOptions}
              onChange={(e) => setFormData({ ...formData, mountOptions: e.target.value })}
              rows={3}
              className="w-full rounded-lg border border-white/[0.12] bg-zinc-950/70 px-3 py-2 font-mono text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <p className="mt-2 text-xs text-muted-foreground">
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

          <div className="space-y-2 rounded-lg border border-white/[0.08] bg-zinc-900/60 p-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Nom:</span>
              <span className="font-mono">{formData.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Source:</span>
              <span className="font-mono">{formData.sourcePath}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Destination:</span>
              <span className="font-mono">{formData.targetPath}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Serveur:</span>
              <span className="font-mono">{nodes.find((n) => n.id === formData.nodeId)?.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Type FS:</span>
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
      setNotice({ type: 'error', message: 'Erreur lors de la création du montage.' });
    }
  };

  const statusColors = {
    pending: 'bg-yellow-500 text-white',
    active: 'bg-green-500 text-white',
    error: 'bg-red-500 text-white',
  };

  return (
    <DashboardLayout>
      <div className="space-y-8">
        {notice && (
          <Alert variant={notice.type === 'error' ? 'destructive' : notice.type === 'warning' ? 'warning' : 'success'}>
            {notice.type === 'error' ? <AlertCircle className="h-4 w-4" /> : notice.type === 'warning' ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            <AlertDescription>{notice.message}</AlertDescription>
          </Alert>
        )}

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Montages Réseau</h1>
            <p className="mt-1 text-sm text-muted-foreground">Gérez les montages NFS et les partages réseau.</p>
          </div>
          <Button
            onClick={() => setWizardOpen(true)}
            className="gap-2 bg-violet-600 text-white hover:bg-violet-500"
          >
            <Plus className="w-5 h-5" />
            Nouveau Montage
          </Button>
        </div>

        {/* Info Box */}
        <InfoBox type="info" title="À propos des montages NFS">
          Les montages NFS permettent de partager des répertoires entre les serveurs à travers le réseau VLAN. Utilisez le
          guide ci-dessous pour configurer facilement vos partages.
        </InfoBox>

        {/* Mounts List */}
        {mounts.length === 0 ? (
          <Card className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
            <CardContent className="pt-12 pb-12 text-center">
              <div className="text-6xl mb-4">📂</div>
              <p className="font-medium text-muted-foreground">Aucun montage configuré</p>
              <p className="mt-2 text-sm text-muted-foreground">Créez votre premier montage NFS en cliquant sur "Nouveau Montage".</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {mounts.map((mount) => (
              <Card key={mount.id} className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <h3 className="text-lg font-semibold text-foreground">{mount.name}</h3>
                        <div className={`px-2 py-1 rounded text-white text-sm font-semibold ${statusColors[mount.status as keyof typeof statusColors]}`}>
                          {mount.status === 'active' && '✓ Actif'}
                          {mount.status === 'pending' && '⏳ En attente'}
                          {mount.status === 'error' && '✗ Erreur'}
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-4 text-sm text-muted-foreground">
                        <div>
                          <span>Source:</span>
                          <p className="font-mono">{mount.sourcePath}</p>
                        </div>
                        <div>
                          <span>Destination:</span>
                          <p className="font-mono">{mount.targetPath}</p>
                        </div>
                        {mount.additionalSources.length > 0 && (
                          <div className="col-span-2">
                            <span>Sources additionnelles:</span>
                            <p className="font-mono text-xs">{mount.additionalSources.join(', ')}</p>
                          </div>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      className="p-2 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                      onClick={() => setNotice({ type: 'warning', message: 'Suppression non implémentée.' })}
                    >
                      <Trash2 className="w-5 h-5" />
                    </Button>
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
