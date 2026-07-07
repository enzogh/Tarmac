'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Network,
  HardDrive,
  Plus,
  Server,
  Trash2,
  Wifi,
  Play,
} from 'lucide-react';
import { api, MountItem, NodeItem, VlanMember } from '../../../lib/api';
import { DashboardLayout } from '../../../components/DashboardLayout';
import { PageHeader } from '../../../components/PageHeader';
import { Callout } from '../../../components/Callout';
import { Card, CardContent } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Badge } from '../../../components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import {
  WizardDialog,
  PresetSelector,
  OperationPreview,
  HelpText,
  InfoBox,
  AdvancedOptions,
  PresetOption,
  StepConfig,
} from '../../../components/ui/wizard';
import { DirectoryBrowser } from '../../../components/ui/directory-browser';
import { NodeLabelBadges, StatCard } from '../../../components/ui';
import { SectionLabel } from '../../../components/SectionLabel';
import { readNodeLabels } from '../../../lib/node-labels';

// ─── Presets ────────────────────────────────────────────────────────────────

const NFS_SHARE_PRESETS: PresetOption[] = [
  {
    id: 'media',
    name: 'Partage Média',
    description: 'Vidéos, musique, photos partagés entre serveurs',
    icon: '🎬',
    config: { exportPath: '/exports/media', mountPath: '/mnt/media', mountOptions: 'defaults,hard,intr,noatime' },
  },
  {
    id: 'backup',
    name: 'Sauvegarde',
    description: 'Dossier dédié aux sauvegardes automatiques',
    icon: '💾',
    config: { exportPath: '/exports/backup', mountPath: '/mnt/backup', mountOptions: 'defaults,hard,intr' },
  },
  {
    id: 'data',
    name: 'Données Partagées',
    description: 'Répertoire de travail commun entre plusieurs nœuds',
    icon: '📂',
    config: { exportPath: '/exports/data', mountPath: '/mnt/data', mountOptions: 'defaults,hard,intr' },
  },
  {
    id: 'cache',
    name: 'Cache Rapide',
    description: 'Optimisé pour les I/O fréquents (SSD)',
    icon: '⚡',
    config: { exportPath: '/exports/cache', mountPath: '/mnt/cache', mountOptions: 'defaults,hard,intr,noatime,actimeo=60' },
  },
];

const MOUNT_EXISTING_PRESETS: PresetOption[] = [
  {
    id: 'home-backup',
    name: 'Sauvegarde Locale',
    description: 'Monter un répertoire existant pour la sauvegarde',
    icon: '💾',
    config: { fsType: 'nfs4', mountOptions: 'defaults,hard,intr', targetPath: '/mnt/backup' },
  },
  {
    id: 'media-share',
    name: 'Partage Média',
    description: 'Configuration optimisée pour les fichiers multimédias',
    icon: '🎬',
    config: { fsType: 'nfs4', mountOptions: 'defaults,hard,intr,noatime', targetPath: '/mnt/media' },
  },
  {
    id: 'fast-cache',
    name: 'Cache Rapide',
    description: 'Optimisé pour les performances (SSD)',
    icon: '⚡',
    config: { fsType: 'nfs4', mountOptions: 'defaults,hard,intr,noatime,actimeo=60', targetPath: '/mnt/cache' },
  },
  {
    id: 'archive',
    name: 'Archive Froide',
    description: 'Configuration pour accès occasionnel',
    icon: '📦',
    config: { fsType: 'nfs4', mountOptions: 'defaults,soft,timeo=300', targetPath: '/mnt/archive' },
  },
];

// ─── NodeCard ────────────────────────────────────────────────────────────────

function NodeCard({
  node,
  vlanIp,
  selected,
  disabled,
  onClick,
  labels = [],
}: {
  node: NodeItem;
  vlanIp?: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  labels?: string[];
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-3 rounded-xl border p-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
        selected
          ? 'border-violet-500/60 bg-violet-500/[0.1] ring-1 ring-violet-500/20'
          : disabled
          ? 'border-white/[0.05] bg-zinc-900/30'
          : 'border-white/[0.08] bg-zinc-900/50 hover:border-white/20 hover:bg-zinc-900/70'
      }`}
    >
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          selected ? 'bg-violet-500/20' : 'bg-zinc-800'
        }`}
      >
        <Server className={`h-4 w-4 ${selected ? 'text-violet-400' : 'text-zinc-400'}`} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{node.name}</p>
        {vlanIp ? (
          <p className="flex items-center gap-1 font-mono text-xs text-emerald-400">
            <Wifi className="h-2.5 w-2.5" />
            {vlanIp}
          </p>
        ) : (
          <p className="text-xs text-zinc-500">Non connecté au VLAN</p>
        )}
        <NodeLabelBadges labels={labels} className="mt-1" />
      </div>
      {selected && <CheckCircle2 className="h-4 w-4 shrink-0 text-violet-400" />}
    </button>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

type WizardMode = 'mount-existing' | 'create-share';

type Notice = { type: 'error' | 'success' | 'warning'; message: string } | null;

export default function MountsPage() {
  const router = useRouter();
  const token = useMemo(
    () => (typeof window !== 'undefined' ? localStorage.getItem('tarmac_token') : null),
    [],
  );

  const [mounts, setMounts] = useState<MountItem[]>([]);
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [vlanMembers, setVlanMembers] = useState<VlanMember[]>([]);
  const [nodeLabels, setNodeLabels] = useState<Record<string, string[]>>({});

  useEffect(() => {
    setNodeLabels(readNodeLabels());
  }, []);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardMode, setWizardMode] = useState<WizardMode>('create-share');
  const [selectedPreset, setSelectedPreset] = useState<PresetOption | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Form — "mount existing NFS"
  const [mountForm, setMountForm] = useState({
    name: '',
    sourcePath: '',
    targetPath: '/mnt',
    fsType: 'nfs4',
    mountOptions: 'defaults,hard,intr',
    nodeId: '',
  });

  // Form — "create + mount NFS share via VLAN"
  const [shareForm, setShareForm] = useState({
    name: '',
    exportNodeId: '',
    exportPath: '/exports',
    mountNodeId: '',
    mountPath: '/mnt/nfs',
    fsType: 'nfs4',
    mountOptions: 'defaults,hard,intr',
  });
  const [exportDirectories, setExportDirectories] = useState<string[]>([]);
  const [clientDirectories, setClientDirectories] = useState<string[]>([]);
  const [existingMountDirectories, setExistingMountDirectories] = useState<string[]>([]);
  const [exportBrowsePath, setExportBrowsePath] = useState('/');
  const [clientBrowsePath, setClientBrowsePath] = useState('/');
  const [existingBrowsePath, setExistingBrowsePath] = useState('/');
  const [directoryLoading, setDirectoryLoading] = useState({
    export: false,
    client: false,
    existing: false,
  });

  // VLAN IP lookup: nodeId → vlanIp
  const nodeVlanIps = useMemo(() => {
    const map: Record<string, string> = {};
    vlanMembers.forEach((m) => {
      map[m.nodeId] = m.vlanIp;
    });
    return map;
  }, [vlanMembers]);

  // Auto-dismiss notice
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  const load = async () => {
    if (!token) return;
    try {
      const [m, n, vlanData] = await Promise.all([
        api.mounts.list(token),
        api.nodes.list(token),
        api.vlan.getAll(token).catch(() => ({ vlans: [] })),
      ]);
      setMounts(m);
      setNodes(n);

      // Collect all VLAN members
      const members: VlanMember[] = [];
      for (const vlan of vlanData.vlans) {
        if (vlan.members?.length) {
          members.push(...vlan.members);
        }
      }
      // If embedded members were empty, fetch them individually
      if (members.length === 0 && vlanData.vlans.length > 0) {
        const arrays = await Promise.all(
          vlanData.vlans.map((v) =>
            api.vlan.getMembers(token, v.id).then((r) => r.members).catch(() => [] as VlanMember[]),
          ),
        );
        arrays.forEach((arr) => members.push(...arr));
      }
      setVlanMembers(members);
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

  const loadLiveDirectories = async (
    kind: 'export' | 'client' | 'existing',
    nodeId: string,
    basePath: string,
  ) => {
    if (!token || !nodeId) return;
    setDirectoryLoading((prev) => ({ ...prev, [kind]: true }));
    try {
      const payload = await api.migrations.listDirectories(token, nodeId, basePath || '/');
      const sorted = [...payload.directories].sort((a, b) => a.localeCompare(b));
      if (kind === 'export') {
        setExportBrowsePath(payload.basePath);
        setExportDirectories(sorted);
      } else if (kind === 'client') {
        setClientBrowsePath(payload.basePath);
        setClientDirectories(sorted);
      } else {
        setExistingBrowsePath(payload.basePath);
        setExistingMountDirectories(sorted);
      }
    } catch {
      if (kind === 'export') setExportDirectories([]);
      if (kind === 'client') setClientDirectories([]);
      if (kind === 'existing') setExistingMountDirectories([]);
      setNotice({
        type: 'warning',
        message: "Navigation live indisponible pour ce nœud (agent hors ligne ou accès dossier refusé).",
      });
    } finally {
      setDirectoryLoading((prev) => ({ ...prev, [kind]: false }));
    }
  };

  useEffect(() => {
    if (!shareForm.exportNodeId) {
      setExportBrowsePath('/');
      setExportDirectories([]);
      return;
    }
    setExportBrowsePath('/');
    void loadLiveDirectories('export', shareForm.exportNodeId, '/');
  }, [shareForm.exportNodeId]);

  useEffect(() => {
    if (!shareForm.mountNodeId) {
      setClientBrowsePath('/');
      setClientDirectories([]);
      return;
    }
    setClientBrowsePath('/');
    void loadLiveDirectories('client', shareForm.mountNodeId, '/');
  }, [shareForm.mountNodeId]);

  useEffect(() => {
    if (!mountForm.nodeId) {
      setExistingBrowsePath('/');
      setExistingMountDirectories([]);
      return;
    }
    setExistingBrowsePath('/');
    void loadLiveDirectories('existing', mountForm.nodeId, '/');
  }, [mountForm.nodeId]);

  const openWizard = (mode: WizardMode) => {
    setWizardMode(mode);
    setSelectedPreset(null);
    setWizardOpen(true);
  };

  const closeWizard = () => {
    setWizardOpen(false);
    setSelectedPreset(null);
  };

  // ── Create NFS share (new feature) ──────────────────────────────────────

  const createNfsShare = async () => {
    if (!token) return;
    const vlanIp = nodeVlanIps[shareForm.exportNodeId];
    if (!vlanIp) {
      setNotice({ type: 'error', message: "Le serveur exportateur n'est pas connecté au VLAN." });
      return;
    }
    if (!shareForm.name.trim() || !shareForm.exportNodeId || !shareForm.exportPath || !shareForm.mountPath) {
      setNotice({ type: 'error', message: 'Complétez tous les champs obligatoires.' });
      return;
    }
    try {
      await api.shares.create(token, {
        name: shareForm.name.trim(),
        path: shareForm.exportPath,
        nodeId: shareForm.exportNodeId,
      });
      await api.mounts.create(token, {
        name: shareForm.name.trim(),
        sourcePath: `${vlanIp}:${shareForm.exportPath}`,
        targetPath: shareForm.mountPath,
        fsType: shareForm.fsType,
        mountOptions: shareForm.mountOptions,
        nodeId: shareForm.mountNodeId || undefined,
      });
      closeWizard();
      setShareForm({ name: '', exportNodeId: '', exportPath: '/exports', mountNodeId: '', mountPath: '/mnt/nfs', fsType: 'nfs4', mountOptions: 'defaults,hard,intr' });
      setNotice({ type: 'success', message: 'Partage NFS créé et configuré avec succès.' });
      await load();
    } catch {
      setNotice({ type: 'error', message: 'Erreur lors de la création du partage NFS.' });
    }
  };

  // ── Mount existing NFS path ───────────────────────────────────────────────

  const createMount = async () => {
    if (!token) return;
    if (!mountForm.name.trim() || !mountForm.sourcePath.trim() || !mountForm.targetPath.trim()) {
      setNotice({ type: 'error', message: 'Complétez le nom, la source et la destination.' });
      return;
    }
    try {
      await api.mounts.create(token, {
        name: mountForm.name.trim(),
        sourcePath: mountForm.sourcePath.trim(),
        targetPath: mountForm.targetPath.trim(),
        fsType: mountForm.fsType,
        mountOptions: mountForm.mountOptions,
        nodeId: mountForm.nodeId || undefined,
      });
      closeWizard();
      setMountForm({ name: '', sourcePath: '', targetPath: '/mnt', fsType: 'nfs4', mountOptions: 'defaults,hard,intr', nodeId: '' });
      setNotice({ type: 'success', message: 'Montage créé.' });
      await load();
    } catch {
      setNotice({ type: 'error', message: 'Erreur lors de la création du montage.' });
    }
  };

  // ── Delete mount ──────────────────────────────────────────────────────────

  const deleteMount = async (mountId: string) => {
    if (!token) return;
    setBusyId(mountId);
    try {
      await api.mounts.delete(token, mountId);
      setNotice({ type: 'success', message: 'Montage supprimé.' });
      await load();
    } catch {
      setNotice({ type: 'error', message: 'Impossible de supprimer ce montage.' });
    } finally {
      setBusyId(null);
    }
  };

  // ── Wizard steps — Create NFS share ──────────────────────────────────────

  const createShareSteps: StepConfig[] = [
    {
      id: 'preset',
      title: 'Type de partage',
      description: 'Quel type de données allez-vous partager via le réseau VLAN ?',
      content: (
        <PresetSelector
          presets={NFS_SHARE_PRESETS}
          selectedId={selectedPreset?.id}
          title=""
          onSelect={(preset) => {
            setSelectedPreset(preset);
            if (preset.config) setShareForm((prev) => ({ ...prev, ...preset.config }));
          }}
        />
      ),
    },
    {
      id: 'export-server',
      title: 'Serveur NFS exportateur',
      description: 'Ce serveur va partager un dossier sur le réseau VLAN',
      content: (
        <div className="space-y-5">
          <div>
            <Label className="mb-2 block text-sm font-medium text-zinc-200">
              Nom du partage
              <HelpText text="Exemple : media-principal, backup-nuit" />
            </Label>
            <Input
              value={shareForm.name}
              onChange={(e) => setShareForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="media-principal"
            />
          </div>

          <div>
            <Label className="mb-2 block text-sm font-medium text-zinc-200">
              Serveur exportateur (NFS Server)
              <HelpText text="Ce serveur va exposer le dossier NFS. Il doit être connecté au VLAN." />
            </Label>
            <div className="mt-2 space-y-2">
              {nodes.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucun serveur disponible</p>
              ) : (
                nodes.map((node) => (
                  <NodeCard
                    key={node.id}
                    node={node}
                    vlanIp={nodeVlanIps[node.id]}
                    selected={shareForm.exportNodeId === node.id}
                    disabled={node.status === 'offline'}
                    labels={nodeLabels[node.id] ?? []}
                    onClick={() =>
                      setShareForm((prev) => ({
                        ...prev,
                        exportNodeId: node.id,
                        mountNodeId: prev.mountNodeId === node.id ? '' : prev.mountNodeId,
                        exportPath: '/exports',
                      }))
                    }
                  />
                ))
              )}
            </div>
          </div>

          <div>
            <Label className="mb-2 block text-sm font-medium text-zinc-200">
              Dossier à exporter
              <HelpText text="Chemin absolu du répertoire qui sera partagé en NFS. Il sera créé s'il n'existe pas." />
            </Label>
            <DirectoryBrowser
              title="Navigateur de dossiers export (live)"
              description="Explorez le serveur NFS en direct, sans saisir les chemins à la main."
              currentPath={exportBrowsePath}
              selectedPath={shareForm.exportPath}
              directories={exportDirectories}
              loading={directoryLoading.export}
              disabled={!shareForm.exportNodeId}
              onBrowse={(path) => void loadLiveDirectories('export', shareForm.exportNodeId, path)}
              onSelect={(path) => setShareForm((prev) => ({ ...prev, exportPath: path }))}
            />
          </div>
        </div>
      ),
    },
    {
      id: 'mount-client',
      title: 'Serveur client',
      description: 'Ce serveur va accéder au partage NFS via le VLAN',
      content: (
        <div className="space-y-5">
          <div>
            <Label className="mb-2 block text-sm font-medium text-zinc-200">
              Serveur client (NFS Client)
              <HelpText text="Ce serveur va monter le partage NFS exposé par le serveur exportateur." />
            </Label>
            <div className="mt-2 space-y-2">
              {nodes
                .filter((n) => n.id !== shareForm.exportNodeId)
                .map((node) => (
                  <NodeCard
                    key={node.id}
                    node={node}
                    vlanIp={nodeVlanIps[node.id]}
                    selected={shareForm.mountNodeId === node.id}
                    disabled={node.status === 'offline'}
                    labels={nodeLabels[node.id] ?? []}
                    onClick={() =>
                      setShareForm((prev) => ({
                        ...prev,
                        mountNodeId: node.id,
                        mountPath: '/mnt/nfs',
                      }))
                    }
                  />
                ))}
            </div>
          </div>

          <div>
            <Label className="mb-2 block text-sm font-medium text-zinc-200">
              Point de montage local
              <HelpText text="Dossier local sur le serveur client où le partage sera accessible." />
            </Label>
            <DirectoryBrowser
              title="Navigateur dossier client (live)"
              description="Choisissez où monter le partage sur le serveur client."
              currentPath={clientBrowsePath}
              selectedPath={shareForm.mountPath}
              directories={clientDirectories}
              loading={directoryLoading.client}
              disabled={!shareForm.mountNodeId}
              onBrowse={(path) => void loadLiveDirectories('client', shareForm.mountNodeId, path)}
              onSelect={(path) => setShareForm((prev) => ({ ...prev, mountPath: path }))}
            />
          </div>

          {shareForm.exportNodeId && shareForm.mountNodeId && (
            <div className="rounded-xl border border-white/[0.08] bg-zinc-950/60 p-4 space-y-3">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Connexion VLAN prévue
              </p>
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0 rounded-lg bg-zinc-900/80 p-2.5 text-center">
                  <p className="truncate text-sm font-semibold">
                    {nodes.find((n) => n.id === shareForm.exportNodeId)?.name}
                  </p>
                  <p className="font-mono text-xs text-violet-300">
                    {nodeVlanIps[shareForm.exportNodeId] ?? '—'}
                  </p>
                  <p className="mt-0.5 text-[10px] text-zinc-500">NFS Server</p>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <ArrowRight className="h-4 w-4 text-emerald-400" />
                  <span className="font-mono text-[10px] text-emerald-400">VLAN</span>
                </div>
                <div className="flex-1 min-w-0 rounded-lg bg-zinc-900/80 p-2.5 text-center">
                  <p className="truncate text-sm font-semibold">
                    {nodes.find((n) => n.id === shareForm.mountNodeId)?.name}
                  </p>
                  <p className="font-mono text-xs text-sky-300">
                    {nodeVlanIps[shareForm.mountNodeId] ?? '—'}
                  </p>
                  <p className="mt-0.5 text-[10px] text-zinc-500">NFS Client</p>
                </div>
              </div>
              <div className="rounded-lg bg-zinc-900/50 px-3 py-2">
                <p className="font-mono text-[11px] text-zinc-400 break-all">
                  {nodeVlanIps[shareForm.exportNodeId] ?? '<ip>'}:{shareForm.exportPath || '<chemin>'}
                  {' → '}
                  {shareForm.mountPath || '<point de montage>'}
                </p>
              </div>
            </div>
          )}

          <AdvancedOptions label="Options NFS avancées">
            <div>
              <Label className="mb-2 block text-sm font-medium text-zinc-200">
                Type de système de fichiers
                <HelpText text="NFS4 est recommandé pour la sécurité et les performances." />
              </Label>
              <Select
                value={shareForm.fsType}
                onValueChange={(v) => setShareForm((prev) => ({ ...prev, fsType: v }))}
              >
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nfs4">NFS 4 (Recommandé)</SelectItem>
                  <SelectItem value="nfs3">NFS 3</SelectItem>
                  <SelectItem value="nfs">NFS (Auto)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-2 block text-sm font-medium text-zinc-200">
                Options de montage
                <HelpText text="Conservez la valeur par défaut si vous n'êtes pas sûr." />
              </Label>
              <Input
                value={shareForm.mountOptions}
                onChange={(e) => setShareForm((prev) => ({ ...prev, mountOptions: e.target.value }))}
                className="font-mono text-sm"
              />
            </div>
          </AdvancedOptions>
        </div>
      ),
    },
    {
      id: 'review',
      title: 'Validation finale',
      description: 'Vérifiez la configuration avant de créer le partage',
      content: (
        <div className="space-y-4">
          <OperationPreview
            steps={[
              { id: 'share', title: 'Création du partage NFS', description: `Export de ${shareForm.exportPath || '…'} sur ${nodes.find((n) => n.id === shareForm.exportNodeId)?.name ?? '…'}` },
              { id: 'mount', title: 'Montage via VLAN', description: `${nodeVlanIps[shareForm.exportNodeId] ?? '…'}:${shareForm.exportPath || '…'} → ${shareForm.mountPath || '…'}` },
              { id: 'verify', title: 'Vérification', description: 'Test de connectivité et validation du montage' },
            ]}
          />

          <div className="space-y-2 rounded-xl border border-white/[0.08] bg-zinc-900/60 p-4 text-sm">
            {[
              ['Nom', shareForm.name || '—'],
              ['Serveur NFS', nodes.find((n) => n.id === shareForm.exportNodeId)?.name ?? '—'],
              ['IP VLAN', nodeVlanIps[shareForm.exportNodeId] ?? '—'],
              ['Dossier exporté', shareForm.exportPath || '—'],
              ['Serveur client', nodes.find((n) => n.id === shareForm.mountNodeId)?.name ?? '—'],
              ['Point de montage', shareForm.mountPath || '—'],
              ['Type FS', shareForm.fsType],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 border-b border-white/[0.05] pb-2 last:border-0 last:pb-0">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-mono text-right break-all">{value}</span>
              </div>
            ))}
          </div>

          {!nodeVlanIps[shareForm.exportNodeId] && (
            <InfoBox type="warning" title="Attention">
              Le serveur exportateur n'a pas d'IP VLAN détectée. Vérifiez qu'il est bien connecté au réseau VLAN avant de continuer.
            </InfoBox>
          )}
        </div>
      ),
    },
  ];

  // ── Wizard steps — Mount existing ────────────────────────────────────────

  const mountExistingSteps: StepConfig[] = [
    {
      id: 'preset',
      title: 'Choisir un modèle',
      description: 'Sélectionnez le type de montage qui correspond à votre cas',
      content: (
        <PresetSelector
          presets={MOUNT_EXISTING_PRESETS}
          selectedId={selectedPreset?.id}
          title=""
          onSelect={(preset) => {
            setSelectedPreset(preset);
            if (preset.config) setMountForm((prev) => ({ ...prev, ...preset.config }));
          }}
        />
      ),
    },
    {
      id: 'paths',
      title: 'Chemins Source et Destination',
      description: "Indiquez d'où proviennent les données et où les monter",
      content: (
        <div className="space-y-4">
          <div>
            <Label className="mb-2 block text-sm font-medium text-zinc-200">
              Nom du montage
              <HelpText text="Exemple : backup-db, media-store" />
            </Label>
            <Input
              value={mountForm.name}
              onChange={(e) => setMountForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="backup-mensuel"
            />
          </div>

          <div>
            <Label className="mb-2 block text-sm font-medium text-zinc-200">
              Chemin source NFS
              <HelpText text="Format : <ip>:<chemin> — ex: 192.168.10.1:/data/backup" />
            </Label>
            <Input
              value={mountForm.sourcePath}
              onChange={(e) => setMountForm((prev) => ({ ...prev, sourcePath: e.target.value }))}
              placeholder="192.168.10.1:/data/backup"
              className="font-mono"
            />
          </div>

          <div>
            <Label className="mb-2 block text-sm font-medium text-zinc-200">
              Point de montage local
              <HelpText text="Où monter le partage sur le serveur destination" />
            </Label>
            <DirectoryBrowser
              title="Navigateur dossier de montage (live)"
              description="Navigation dynamique sur le serveur client pour éviter la saisie manuelle."
              currentPath={existingBrowsePath}
              selectedPath={mountForm.targetPath}
              directories={existingMountDirectories}
              loading={directoryLoading.existing}
              disabled={!mountForm.nodeId}
              onBrowse={(path) => void loadLiveDirectories('existing', mountForm.nodeId, path)}
              onSelect={(path) => setMountForm((prev) => ({ ...prev, targetPath: path }))}
            />
          </div>

          <div>
            <Label className="mb-2 block text-sm font-medium text-zinc-200">
              Serveur de montage
              <HelpText text="Nœud où sera monté le partage" />
            </Label>
            <Select
              value={mountForm.nodeId}
              onValueChange={(v) =>
                setMountForm((prev) => ({ ...prev, nodeId: v, targetPath: '/mnt' }))
              }
            >
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Choisir un serveur" />
              </SelectTrigger>
              <SelectContent>
                {nodes.map((node) => (
                  <SelectItem key={node.id} value={node.id}>
                    {node.name} ({node.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <AdvancedOptions label="Options NFS avancées">
            <div>
              <Label className="mb-2 block text-sm font-medium text-zinc-200">
                Type de système de fichiers
                <HelpText text="NFS4 est recommandé." />
              </Label>
              <Select
                value={mountForm.fsType}
                onValueChange={(v) => setMountForm((prev) => ({ ...prev, fsType: v }))}
              >
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nfs4">NFS 4 (Recommandé)</SelectItem>
                  <SelectItem value="nfs3">NFS 3</SelectItem>
                  <SelectItem value="nfs">NFS (Auto)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-2 block text-sm font-medium text-zinc-200">
                Options de montage
                <HelpText text="Conservez la valeur par défaut si vous n'êtes pas sûr." />
              </Label>
              <Input
                value={mountForm.mountOptions}
                onChange={(e) => setMountForm((prev) => ({ ...prev, mountOptions: e.target.value }))}
                className="font-mono text-sm"
              />
            </div>
          </AdvancedOptions>
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
              { id: 'validate', title: 'Validation des paramètres', description: 'Vérification de la connectivité et des chemins' },
              { id: 'setup', title: 'Configuration du montage NFS', description: 'Création du répertoire et montage du partage' },
              { id: 'verify', title: 'Vérification et test', description: 'Test du montage et enregistrement' },
            ]}
          />
          <div className="space-y-2 rounded-xl border border-white/[0.08] bg-zinc-900/60 p-4 text-sm">
            {[
              ['Nom', mountForm.name || '—'],
              ['Source', mountForm.sourcePath || '—'],
              ['Destination', mountForm.targetPath || '—'],
              ['Serveur', nodes.find((n) => n.id === mountForm.nodeId)?.name ?? '—'],
              ['Type FS', mountForm.fsType],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 border-b border-white/[0.05] pb-2 last:border-0 last:pb-0">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-mono text-right break-all">{value}</span>
              </div>
            ))}
          </div>
          <InfoBox type="info" title="Prêt à continuer ?">
            Ce montage sera automatiquement restauré au redémarrage du serveur, sans intervention manuelle.
          </InfoBox>
        </div>
      ),
    },
  ];

  // ── Status helpers ────────────────────────────────────────────────────────

  const statusConfig = {
    active: { label: 'Actif', variant: 'success' as const },
    pending: { label: 'En attente', variant: 'warning' as const },
    error: { label: 'Erreur', variant: 'destructive' as const },
  };

  const activeMounts = mounts.filter((mount) => mount.status === 'active').length;
  const errorMounts = mounts.filter((mount) => mount.status === 'error').length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="space-y-8">
        {notice && (
          <Alert variant={notice.type === 'error' ? 'destructive' : notice.type === 'warning' ? 'warning' : 'success'}>
            {notice.type === 'error' ? (
              <AlertCircle className="h-4 w-4" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            <AlertDescription>{notice.message}</AlertDescription>
          </Alert>
        )}

        {/* Header */}
        <PageHeader
          icon={HardDrive}
          title="Montages"
          description="Montez des sources NFS, avec repli en cas de panne, sur un nœud."
          actions={
            <>
              <Button variant="outline" onClick={() => openWizard('mount-existing')} className="gap-2">
                <HardDrive className="h-4 w-4" />
                Monter un partage
              </Button>
              <Button onClick={() => openWizard('create-share')} className="gap-2 bg-violet-600 text-white hover:bg-violet-500">
                <Network className="h-4 w-4" />
                Nouveau partage NFS
              </Button>
            </>
          }
        />

        <section className="space-y-4">
          <SectionLabel>Aperçu</SectionLabel>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <StatCard label="Montages" value={mounts.length} icon={<HardDrive className="h-8 w-8" />} changeType="neutral" />
            <StatCard
              label="Actifs"
              value={activeMounts}
              icon={<CheckCircle2 className="h-8 w-8" />}
              changeType={activeMounts === mounts.length && mounts.length > 0 ? 'up' : 'neutral'}
            />
            <StatCard
              label="En erreur"
              value={errorMounts}
              icon={<AlertCircle className="h-8 w-8" />}
              changeType={errorMounts > 0 ? 'down' : 'up'}
            />
          </div>
        </section>

        {/* Info banner */}
        <Callout variant="info">
          <p>
            <strong className="font-medium text-violet-300">Nouveau partage NFS</strong> crée et monte un dossier
            partagé entre deux serveurs via le réseau VLAN en un seul clic.{' '}
            <strong className="font-medium text-violet-300">Monter un partage</strong> connecte un partage NFS déjà
            existant.
          </p>
          <p className="mt-1">Tous les montages sont rendus persistants automatiquement.</p>
        </Callout>

        {/* Mount list */}
        <SectionLabel>Montages</SectionLabel>
        {mounts.length === 0 ? (
          <Card className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
            <CardContent className="py-16 text-center">
              <div className="mb-4 text-5xl">📂</div>
              <p className="font-medium text-muted-foreground">Aucun montage configuré</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Créez votre premier partage NFS en cliquant sur{' '}
                <button
                  className="text-violet-400 underline hover:text-violet-300"
                  onClick={() => openWizard('create-share')}
                >
                  Nouveau partage NFS
                </button>
                .
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {mounts.map((mount) => {
              const sc = statusConfig[mount.status as keyof typeof statusConfig] ?? { label: mount.status, variant: 'secondary' as const };
              return (
                <Card key={mount.id} className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-3">
                          <h3 className="truncate text-base font-semibold text-foreground">{mount.name}</h3>
                          <Badge variant={sc.variant}>{sc.label}</Badge>
                        </div>
                        <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                          <div>
                            <p className="mb-0.5 font-medium text-zinc-400">Source</p>
                            <p className="font-mono text-zinc-300 break-all">{mount.sourcePath}</p>
                          </div>
                          <div>
                            <p className="mb-0.5 font-medium text-zinc-400">Point de montage</p>
                            <p className="font-mono text-zinc-300">{mount.targetPath}</p>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => deleteMount(mount.id)}
                        disabled={busyId === mount.id}
                        className="shrink-0 rounded-lg p-2 text-zinc-500 transition-colors hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-40"
                        title="Supprimer"
                      >
                        {busyId === mount.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Wizard — Create NFS share */}
      {wizardOpen && wizardMode === 'create-share' && (
        <WizardDialog
          title="Nouveau partage NFS via VLAN"
          description="Créez et montez un dossier NFS partagé entre deux serveurs de votre réseau VLAN"
          steps={createShareSteps}
          onComplete={createNfsShare}
          onCancel={closeWizard}
          completeButtonLabel="Créer le partage"
        />
      )}

      {/* Wizard — Mount existing */}
      {wizardOpen && wizardMode === 'mount-existing' && (
        <WizardDialog
          title="Monter un partage NFS existant"
          description="Connectez un partage NFS déjà disponible sur votre réseau"
          steps={mountExistingSteps}
          onComplete={createMount}
          onCancel={closeWizard}
          completeButtonLabel="Créer le montage"
        />
      )}
    </DashboardLayout>
  );
}
