'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  ArrowRightLeft,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Pencil,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCcw,
  Server,
  Trash2,
} from 'lucide-react';
import { api, MigrationItem, NodeItem } from '../../../lib/api';
import { DashboardLayout } from '../../../components/DashboardLayout';
import { PageHeader } from '../../../components/PageHeader';
import { Callout } from '../../../components/Callout';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Progress } from '../../../components/ui/progress';
import { Button } from '../../../components/ui/button';
import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Badge } from '../../../components/ui/badge';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import {
  WizardDialog,
  PresetSelector,
  OperationPreview,
  HelpText,
  InfoBox,
  PresetOption,
  StepConfig,
} from '../../../components/ui/wizard';
import { DirectoryBrowser } from '../../../components/ui/directory-browser';

const MIGRATION_PRESETS: PresetOption[] = [
  {
    id: 'maintenance',
    name: 'Maintenance Planifiée',
    description: 'Migrer les données avant une maintenance serveur',
    icon: '🔧',
    config: { reason: 'planned-maintenance' },
  },
  {
    id: 'load-balance',
    name: 'Rééquilibrage de Charge',
    description: 'Redistribuer les données pour optimiser les ressources',
    icon: '⚖️',
    config: { reason: 'load-balancing' },
  },
  {
    id: 'disk-replacement',
    name: 'Remplacement de Disque',
    description: "Migrer avant le remplacement d'un disque défaillant",
    icon: '💾',
    config: { reason: 'disk-replacement' },
  },
  {
    id: 'decommission',
    name: 'Décommissionnement',
    description: "Migrer toutes les données avant retrait d'un serveur",
    icon: '🗑️',
    config: { reason: 'decommission' },
  },
];

type Notice = { type: 'error' | 'success'; message: string } | null;
type MigrationEndpointKind = 'node' | 'seedbox' | 'storagebox';

const isRemoteKind = (kind: MigrationEndpointKind | null | undefined): kind is Exclude<MigrationEndpointKind, 'node'> =>
  kind === 'seedbox' || kind === 'storagebox';
const isStorageboxKind = (kind: MigrationEndpointKind | null | undefined): kind is 'storagebox' => kind === 'storagebox';
const defaultBrowsePath = (kind: MigrationEndpointKind) => (kind === 'storagebox' ? '/home' : '/');

export default function MigrationsPage() {
  const router = useRouter();
  const token = useMemo(() => (typeof window !== 'undefined' ? localStorage.getItem('tarmac_token') : null), []);

  const [migrations, setMigrations] = useState<MigrationItem[]>([]);
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<PresetOption | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    sourceKind: 'node' as MigrationEndpointKind,
    targetKind: 'node' as MigrationEndpointKind,
    sourceNodeId: '',
    targetNodeId: '',
    sourcePath: '',
    targetPath: '',
    reason: '',
    sourceSeedboxHost: '',
    sourceSeedboxUser: '',
    sourceSeedboxPassword: '',
    sourceSeedboxPort: '',
    targetSeedboxHost: '',
    targetSeedboxUser: '',
    targetSeedboxPassword: '',
    targetSeedboxPort: '',
  });
  const [sourceDirectories, setSourceDirectories] = useState<string[]>([]);
  const [targetDirectories, setTargetDirectories] = useState<string[]>([]);
  const [sourceBrowsePath, setSourceBrowsePath] = useState('/');
  const [targetBrowsePath, setTargetBrowsePath] = useState('/');
  const [directoriesLoading, setDirectoriesLoading] = useState<{ source: boolean; target: boolean }>({
    source: false,
    target: false,
  });

  const [editMigration, setEditMigration] = useState<MigrationItem | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    sourceNodeId: '',
    targetNodeId: '',
    notes: '',
  });
  const [deleteMigration, setDeleteMigration] = useState<MigrationItem | null>(null);

  const load = async () => {
    if (!token) return;
    try {
      const [mg, n] = await Promise.all([api.migrations.list(token), api.nodes.list(token)]);
      setMigrations(mg);
      setNodes(n);
    } catch {
      localStorage.removeItem('tarmac_token');
      router.push('/login');
    }
  };

  const loadDirectories = async (kind: 'source' | 'target', basePath: string) => {
    if (!token) return;
    const endpointKind = kind === 'source' ? formData.sourceKind : formData.targetKind;
    const isRemote = isRemoteKind(endpointKind);
    const nodeId =
      kind === 'source'
        ? isRemote
          ? formData.targetNodeId
          : formData.sourceNodeId
        : isRemote
          ? formData.sourceNodeId
          : formData.targetNodeId;
    if (!nodeId) return;

    setDirectoriesLoading((prev) => ({ ...prev, [kind]: true }));
    try {
      const payload = isRemote
        ? await api.migrations.listRemoteDirectories(token, {
            nodeId,
            host: kind === 'source' ? formData.sourceSeedboxHost : formData.targetSeedboxHost,
            username: kind === 'source' ? formData.sourceSeedboxUser : formData.targetSeedboxUser,
            password: kind === 'source' ? formData.sourceSeedboxPassword : formData.targetSeedboxPassword,
            port:
              kind === 'source'
                ? formData.sourceSeedboxPort || (isStorageboxKind(formData.sourceKind) ? '23' : '22')
                : formData.targetSeedboxPort || (isStorageboxKind(formData.targetKind) ? '23' : '22'),
            basePath: basePath || '/',
            endpointType: isStorageboxKind(endpointKind) ? 'storagebox' : 'seedbox',
          })
        : await api.migrations.listDirectories(token, nodeId, basePath || '/');
      const sorted = [...payload.directories].sort((a, b) => a.localeCompare(b));
      if (kind === 'source') {
        setSourceBrowsePath(payload.basePath);
        setSourceDirectories(sorted);
      } else {
        setTargetBrowsePath(payload.basePath);
        setTargetDirectories(sorted);
      }
    } catch (error) {
      if (kind === 'source') {
        setSourceDirectories([]);
      } else {
        setTargetDirectories([]);
      }
      setNotice({
        type: 'error',
        message:
          error instanceof Error && error.message
            ? error.message
            : "Impossible de charger les dossiers en direct depuis l'endpoint sélectionné.",
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
    const sourceReady =
      formData.sourceKind === 'node'
        ? !!formData.sourceNodeId
        : !!formData.targetNodeId && !!formData.sourceSeedboxHost && !!formData.sourceSeedboxUser;
    if (!sourceReady) {
      setSourceBrowsePath(defaultBrowsePath(formData.sourceKind));
      setSourceDirectories([]);
      return;
    }
    const nextBasePath = defaultBrowsePath(formData.sourceKind);
    setSourceBrowsePath(nextBasePath);
    void loadDirectories('source', nextBasePath);
  }, [
    formData.sourceKind,
    formData.sourceNodeId,
    formData.targetNodeId,
    formData.sourceSeedboxHost,
    formData.sourceSeedboxUser,
    formData.sourceSeedboxPort,
  ]);

  useEffect(() => {
    const targetReady =
      formData.targetKind === 'node'
        ? !!formData.targetNodeId
        : !!formData.sourceNodeId && !!formData.targetSeedboxHost && !!formData.targetSeedboxUser;
    if (!targetReady) {
      setTargetBrowsePath(defaultBrowsePath(formData.targetKind));
      setTargetDirectories([]);
      return;
    }
    const nextBasePath = defaultBrowsePath(formData.targetKind);
    setTargetBrowsePath(nextBasePath);
    void loadDirectories('target', nextBasePath);
  }, [
    formData.targetKind,
    formData.targetNodeId,
    formData.sourceNodeId,
    formData.targetSeedboxHost,
    formData.targetSeedboxUser,
    formData.targetSeedboxPort,
  ]);

  const nodesById = useMemo(() => Object.fromEntries(nodes.map((node) => [node.id, node.name] as const)), [nodes]);
  const activeMigrations = useMemo(() => migrations.filter((migration) => migration.status !== 'completed'), [migrations]);
  const archivedMigrations = useMemo(() => migrations.filter((migration) => migration.status === 'completed'), [migrations]);

  const statusLabel: Record<MigrationItem['status'], string> = {
    pending: 'En attente',
    running: 'En cours',
    completed: 'Terminée',
    failed: 'Échouée',
  };
  const statusBadgeVariant: Record<MigrationItem['status'], 'warning' | 'info' | 'success' | 'destructive'> = {
    pending: 'warning',
    running: 'info',
    completed: 'success',
    failed: 'destructive',
  };

  const metrics = useMemo(
    () => ({
      total: migrations.length,
      running: migrations.filter((migration) => migration.status === 'running').length,
      pending: migrations.filter((migration) => migration.status === 'pending').length,
      failed: migrations.filter((migration) => migration.status === 'failed').length,
    }),
    [migrations],
  );

  const canEditMigration = (migration: MigrationItem) =>
    (migration.status === 'pending' || migration.status === 'failed') &&
    !isRemoteKind(migration.sourceKind ?? undefined) &&
    !isRemoteKind(migration.targetKind ?? undefined);
  const canDeleteMigration = (migration: MigrationItem) => migration.status === 'pending';
  const formatMigrationEndpoint = (migration: MigrationItem, kind: 'source' | 'target') => {
    if (kind === 'source' && isRemoteKind(migration.sourceKind ?? undefined)) {
      return `${migration.sourceSeedboxUser ?? 'user'}@${migration.sourceSeedboxHost ?? 'seedbox'}`;
    }
    if (kind === 'target' && isRemoteKind(migration.targetKind ?? undefined)) {
      return `${migration.targetSeedboxUser ?? 'user'}@${migration.targetSeedboxHost ?? 'seedbox'}`;
    }
    const nodeId = kind === 'source' ? migration.sourceNodeId : migration.targetNodeId;
    return nodesById[nodeId ?? ''] ?? 'Non défini';
  };

  const validateMigrationInput = () => {
    if (!formData.name.trim()) {
      setNotice({ type: 'error', message: 'Complétez le nom de la migration.' });
      return false;
    }
    if (isRemoteKind(formData.sourceKind) && isRemoteKind(formData.targetKind)) {
      setNotice({ type: 'error', message: 'Au moins un côté doit être un serveur Tarmac.' });
      return false;
    }
    if (formData.sourceKind === 'node' && !formData.sourceNodeId) {
      setNotice({ type: 'error', message: 'Sélectionnez un serveur source.' });
      return false;
    }
    if (formData.targetKind === 'node' && !formData.targetNodeId) {
      setNotice({ type: 'error', message: 'Sélectionnez un serveur destination.' });
      return false;
    }
    if (formData.sourceKind === 'node' && formData.targetKind === 'node' && formData.sourceNodeId === formData.targetNodeId) {
      setNotice({ type: 'error', message: 'La source et la destination doivent être différentes.' });
      return false;
    }
    if (isRemoteKind(formData.sourceKind) && (!formData.sourceSeedboxHost || !formData.sourceSeedboxUser || !formData.sourceSeedboxPassword)) {
      setNotice({ type: 'error', message: 'Complétez les accès source distants (hôte, utilisateur, mot de passe).' });
      return false;
    }
    if (isRemoteKind(formData.targetKind) && (!formData.targetSeedboxHost || !formData.targetSeedboxUser || !formData.targetSeedboxPassword)) {
      setNotice({ type: 'error', message: 'Complétez les accès destination distants (hôte, utilisateur, mot de passe).' });
      return false;
    }
    return true;
  };

  const createMigration = async () => {
    if (!token) return;
    if (!validateMigrationInput()) return;
    if (!formData.sourcePath || !formData.targetPath) {
      setNotice({
        type: 'error',
        message: 'Sélectionnez aussi les dossiers source et destination.',
      });
      return;
    }
    try {
      await api.migrations.create(token, {
        name: formData.name.trim(),
        sourceNodeId: formData.sourceNodeId || undefined,
        targetNodeId: formData.targetNodeId || undefined,
        sourcePath: formData.sourcePath,
        targetPath: formData.targetPath,
        reason: formData.reason || undefined,
        sourceKind: formData.sourceKind,
        targetKind: formData.targetKind,
        sourceSeedboxHost: isRemoteKind(formData.sourceKind) ? formData.sourceSeedboxHost : undefined,
        sourceSeedboxUser: isRemoteKind(formData.sourceKind) ? formData.sourceSeedboxUser : undefined,
        sourceSeedboxPassword: isRemoteKind(formData.sourceKind) ? formData.sourceSeedboxPassword : undefined,
        sourceSeedboxPort: isRemoteKind(formData.sourceKind)
          ? (formData.sourceSeedboxPort || (isStorageboxKind(formData.sourceKind) ? '23' : '22'))
          : undefined,
        targetSeedboxHost: isRemoteKind(formData.targetKind) ? formData.targetSeedboxHost : undefined,
        targetSeedboxUser: isRemoteKind(formData.targetKind) ? formData.targetSeedboxUser : undefined,
        targetSeedboxPassword: isRemoteKind(formData.targetKind) ? formData.targetSeedboxPassword : undefined,
        targetSeedboxPort: isRemoteKind(formData.targetKind)
          ? (formData.targetSeedboxPort || (isStorageboxKind(formData.targetKind) ? '23' : '22'))
          : undefined,
      });
      setWizardOpen(false);
      setFormData({
        name: '',
        sourceKind: 'node',
        targetKind: 'node',
        sourceNodeId: '',
        targetNodeId: '',
        sourcePath: '',
        targetPath: '',
        reason: '',
        sourceSeedboxHost: '',
        sourceSeedboxUser: '',
        sourceSeedboxPassword: '',
        sourceSeedboxPort: '',
        targetSeedboxHost: '',
        targetSeedboxUser: '',
        targetSeedboxPassword: '',
        targetSeedboxPort: '',
      });
      setSelectedPreset(null);
      setNotice({ type: 'success', message: 'Migration créée.' });
      await load();
    } catch {
      setNotice({ type: 'error', message: 'Erreur lors de la création de la migration.' });
    }
  };

  const startMigration = async (migrationId: string) => {
    if (!token) return;
    setBusyId(migrationId);
    try {
      await api.migrations.start(token, migrationId);
      setNotice({ type: 'success', message: 'Migration démarrée.' });
      await load();
    } catch {
      setNotice({ type: 'error', message: 'Impossible de démarrer cette migration.' });
    } finally {
      setBusyId(null);
    }
  };

  const retryMigration = async (migrationId: string) => {
    if (!token) return;
    setBusyId(migrationId);
    try {
      await api.migrations.retry(token, migrationId);
      setNotice({ type: 'success', message: 'Migration relancée.' });
      await load();
    } catch {
      setNotice({ type: 'error', message: 'Impossible de relancer cette migration.' });
    } finally {
      setBusyId(null);
    }
  };

  const stopMigration = async (migrationId: string) => {
    if (!token) return;
    setBusyId(migrationId);
    try {
      await api.migrations.stop(token, migrationId);
      setNotice({ type: 'success', message: 'Migration arrêtée.' });
      await load();
    } catch {
      setNotice({ type: 'error', message: 'Impossible d’arrêter cette migration.' });
    } finally {
      setBusyId(null);
    }
  };

  const openEditDialog = (migration: MigrationItem) => {
    setEditMigration(migration);
    setEditForm({
      name: migration.name,
      sourceNodeId: migration.sourceNodeId ?? '',
      targetNodeId: migration.targetNodeId ?? '',
      notes: migration.notes ?? '',
    });
  };

  const saveEdit = async () => {
    if (!token || !editMigration) return;
    if (!editForm.name.trim() || !editForm.sourceNodeId || !editForm.targetNodeId) {
      setNotice({ type: 'error', message: 'Complétez le nom, la source et la destination.' });
      return;
    }
    if (editForm.sourceNodeId === editForm.targetNodeId) {
      setNotice({ type: 'error', message: 'La source et la destination doivent être différentes.' });
      return;
    }
    setBusyId(editMigration.id);
    try {
      await api.migrations.update(token, editMigration.id, {
        name: editForm.name.trim(),
        sourceNodeId: editForm.sourceNodeId,
        targetNodeId: editForm.targetNodeId,
        notes: editForm.notes.trim() || undefined,
      });
      setEditMigration(null);
      setNotice({ type: 'success', message: 'Migration modifiée.' });
      await load();
    } catch {
      setNotice({ type: 'error', message: 'Impossible de modifier cette migration.' });
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!token || !deleteMigration) return;
    setBusyId(deleteMigration.id);
    try {
      await api.migrations.remove(token, deleteMigration.id);
      setDeleteMigration(null);
      setNotice({ type: 'success', message: 'Migration supprimée.' });
      await load();
    } catch {
      setNotice({ type: 'error', message: 'Impossible de supprimer cette migration.' });
    } finally {
      setBusyId(null);
    }
  };

  const wizardSteps: StepConfig[] = [
    {
      id: 'choose-preset',
      title: 'Raison de la migration',
      description: 'Choisissez le scénario qui correspond à votre besoin',
      content: (
        <div>
          <PresetSelector
            presets={MIGRATION_PRESETS}
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
              ✓ Sélectionné: <strong>{selectedPreset.name}</strong>
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'select-nodes',
      title: 'Choix des serveurs',
      description: 'Définissez la source et la destination',
      content: (
        <div className="space-y-4">
          <div>
            <Label className="mb-2 block text-sm font-medium text-zinc-200">
              Nom de la migration
              <HelpText text="Exemple: Migration stockage principal vers stockage secours" />
            </Label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Nom de la migration"
              className="h-10"
            />
          </div>

          <div>
            <Label className="mb-2 block text-sm font-medium text-zinc-200">
              Type de source
              <HelpText text="Serveur Tarmac, seedbox SSH ou Storage Box Hetzner (SSH port 23)." />
            </Label>
            <Select
              value={formData.sourceKind}
              onValueChange={(value: MigrationEndpointKind) => {
                setSourceBrowsePath(defaultBrowsePath(value));
                setSourceDirectories([]);
                setFormData((prev) => ({
                  ...prev,
                  sourceKind: value,
                  targetKind: isRemoteKind(value) && isRemoteKind(prev.targetKind) ? 'node' : prev.targetKind,
                  sourceNodeId: value === 'node' ? prev.sourceNodeId : '',
                  sourceSeedboxPort:
                    value === 'storagebox' ? (prev.sourceSeedboxPort || '23') : value === 'seedbox' ? (prev.sourceSeedboxPort || '22') : '',
                  sourcePath: '',
                }));
              }}
            >
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="node">Serveur Tarmac</SelectItem>
                <SelectItem value="seedbox">Seedbox SSH</SelectItem>
                <SelectItem value="storagebox">Storage Box Hetzner</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {formData.sourceKind === 'node' ? (
            <div>
              <Label className="mb-2 block text-sm font-medium text-zinc-200">
              Serveur source
              <HelpText text="Le serveur qui contient les données actuellement" />
            </Label>
            <Select
              value={formData.sourceNodeId}
              onValueChange={(value) => {
                setSourceBrowsePath(defaultBrowsePath(formData.sourceKind));
                setFormData((prev) => ({
                  ...prev,
                  sourceNodeId: value,
                  targetNodeId: prev.targetNodeId === value ? '' : prev.targetNodeId,
                  sourcePath: '',
                  targetPath: '',
                }));
              }}
            >
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Choisir un serveur source" />
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
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label className="mb-2 block text-sm font-medium text-zinc-200">
                  {isStorageboxKind(formData.sourceKind) ? 'Host Storage Box source' : 'Host seedbox source'}
                </Label>
                <Input
                  value={formData.sourceSeedboxHost}
                  onChange={(e) => setFormData((prev) => ({ ...prev, sourceSeedboxHost: e.target.value, sourcePath: '' }))}
                  placeholder={isStorageboxKind(formData.sourceKind) ? 'u123456.your-storagebox.de' : 'xx.ultra.cc'}
                />
              </div>
              <div>
                <Label className="mb-2 block text-sm font-medium text-zinc-200">Utilisateur source</Label>
                <Input
                  value={formData.sourceSeedboxUser}
                  onChange={(e) => setFormData((prev) => ({ ...prev, sourceSeedboxUser: e.target.value, sourcePath: '' }))}
                  placeholder="username"
                />
              </div>
              <div>
                <Label className="mb-2 block text-sm font-medium text-zinc-200">Mot de passe source</Label>
                <Input
                  type="password"
                  value={formData.sourceSeedboxPassword}
                  onChange={(e) => setFormData((prev) => ({ ...prev, sourceSeedboxPassword: e.target.value, sourcePath: '' }))}
                  placeholder="••••••••"
                />
              </div>
              <div>
                <Label className="mb-2 block text-sm font-medium text-zinc-200">Port SSH source</Label>
                <Input
                  value={formData.sourceSeedboxPort}
                  onChange={(e) => setFormData((prev) => ({ ...prev, sourceSeedboxPort: e.target.value, sourcePath: '' }))}
                  placeholder={isStorageboxKind(formData.sourceKind) ? '23' : '22'}
                />
              </div>
            </div>
          )}

          <div>
            <Label className="mb-2 block text-sm font-medium text-zinc-200">
              Type de destination
              <HelpText text="Serveur Tarmac, seedbox SSH distante, ou Storage Box Hetzner." />
            </Label>
            <Select
              value={formData.targetKind}
              onValueChange={(value: MigrationEndpointKind) => {
                setTargetBrowsePath(defaultBrowsePath(value));
                setTargetDirectories([]);
                setFormData((prev) => ({
                  ...prev,
                  targetKind: value,
                  sourceKind: isRemoteKind(value) && isRemoteKind(prev.sourceKind) ? 'node' : prev.sourceKind,
                  targetNodeId: value === 'node' ? prev.targetNodeId : '',
                  targetSeedboxPort:
                    value === 'storagebox' ? (prev.targetSeedboxPort || '23') : value === 'seedbox' ? (prev.targetSeedboxPort || '22') : '',
                  targetPath: '',
                }));
              }}
            >
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="node">Serveur Tarmac</SelectItem>
                <SelectItem value="seedbox">Seedbox SSH</SelectItem>
                <SelectItem value="storagebox">Storage Box Hetzner</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {formData.targetKind === 'node' ? (
            <div>
              <Label className="mb-2 block text-sm font-medium text-zinc-200">
              Serveur destination
              <HelpText text="Le serveur qui recevra les données" />
            </Label>
            <Select
              value={formData.targetNodeId}
              onValueChange={(value) => {
                setTargetBrowsePath(defaultBrowsePath(formData.targetKind));
                setFormData((prev) => ({ ...prev, targetNodeId: value, targetPath: '' }));
              }}
            >
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Choisir un serveur destination" />
              </SelectTrigger>
              <SelectContent>
                {nodes
                  .filter((node) => formData.sourceKind !== 'node' || node.id !== formData.sourceNodeId)
                  .map((node) => (
                    <SelectItem key={node.id} value={node.id}>
                      {node.name} ({node.status})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label className="mb-2 block text-sm font-medium text-zinc-200">
                  {isStorageboxKind(formData.targetKind) ? 'Host Storage Box destination' : 'Host seedbox destination'}
                </Label>
                <Input
                  value={formData.targetSeedboxHost}
                  onChange={(e) => setFormData((prev) => ({ ...prev, targetSeedboxHost: e.target.value, targetPath: '' }))}
                  placeholder={isStorageboxKind(formData.targetKind) ? 'u123456.your-storagebox.de' : 'yy.ultra.cc'}
                />
              </div>
              <div>
                <Label className="mb-2 block text-sm font-medium text-zinc-200">Utilisateur destination</Label>
                <Input
                  value={formData.targetSeedboxUser}
                  onChange={(e) => setFormData((prev) => ({ ...prev, targetSeedboxUser: e.target.value, targetPath: '' }))}
                  placeholder="username"
                />
              </div>
              <div>
                <Label className="mb-2 block text-sm font-medium text-zinc-200">Mot de passe destination</Label>
                <Input
                  type="password"
                  value={formData.targetSeedboxPassword}
                  onChange={(e) => setFormData((prev) => ({ ...prev, targetSeedboxPassword: e.target.value, targetPath: '' }))}
                  placeholder="••••••••"
                />
              </div>
              <div>
                <Label className="mb-2 block text-sm font-medium text-zinc-200">Port SSH destination</Label>
                <Input
                  value={formData.targetSeedboxPort}
                  onChange={(e) => setFormData((prev) => ({ ...prev, targetSeedboxPort: e.target.value, targetPath: '' }))}
                  placeholder={isStorageboxKind(formData.targetKind) ? '23' : '22'}
                />
              </div>
            </div>
          )}

          <Alert variant="info">
            <ArrowRightLeft className="h-4 w-4" />
            <AlertDescription>Flux prévu: source → destination. Vous pourrez modifier tant que ce n’est pas lancé.</AlertDescription>
          </Alert>
          <div className="rounded-lg border border-white/10 bg-zinc-950/60 p-3">
            <p className="text-xs text-muted-foreground">Résultat attendu</p>
            <div className="mt-2 flex items-center gap-2 text-sm font-medium">
              <span>
                {isRemoteKind(formData.sourceKind)
                  ? `${formData.sourceSeedboxUser || 'user'}@${formData.sourceSeedboxHost || 'seedbox'}`
                  : formData.sourceNodeId
                    ? (nodesById[formData.sourceNodeId] ?? 'Source')
                    : 'Source'}
              </span>
              <ArrowRight className="h-4 w-4 text-violet-300" />
              <span>
                {isRemoteKind(formData.targetKind)
                  ? `${formData.targetSeedboxUser || 'user'}@${formData.targetSeedboxHost || 'seedbox'}`
                  : formData.targetNodeId
                    ? (nodesById[formData.targetNodeId] ?? 'Destination')
                    : 'Destination'}
              </span>
            </div>
          </div>

          <DirectoryBrowser
            title="Dossier source (live)"
            description={
              isStorageboxKind(formData.sourceKind)
                ? 'Navigation en direct sur la Storage Box source via SFTP (port SSH 23).'
                : formData.sourceKind === 'seedbox'
                  ? "Navigation en direct sur la seedbox source via un nœud Tarmac connecté."
                : "Navigation en direct sur le serveur source."
            }
            currentPath={sourceBrowsePath}
            selectedPath={formData.sourcePath}
            directories={sourceDirectories}
            loading={directoriesLoading.source}
            disabled={
              formData.sourceKind === 'node'
                ? !formData.sourceNodeId
                : !formData.targetNodeId || !formData.sourceSeedboxHost || !formData.sourceSeedboxUser
            }
            onBrowse={(path) => void loadDirectories('source', path)}
            onSelect={(path) => setFormData((prev) => ({ ...prev, sourcePath: path }))}
          />

          <DirectoryBrowser
            title="Dossier destination (live)"
            description={
              isStorageboxKind(formData.targetKind)
                ? 'Navigation en direct sur la Storage Box destination via SFTP.'
                : formData.targetKind === 'seedbox'
                  ? 'Navigation en direct sur la seedbox destination.'
                : 'Navigation en direct sur le serveur de destination.'
            }
            currentPath={targetBrowsePath}
            selectedPath={formData.targetPath}
            directories={targetDirectories}
            loading={directoriesLoading.target}
            disabled={
              formData.targetKind === 'node'
                ? !formData.targetNodeId
                : !formData.sourceNodeId || !formData.targetSeedboxHost || !formData.targetSeedboxUser
            }
            onBrowse={(path) => void loadDirectories('target', path)}
            onSelect={(path) => setFormData((prev) => ({ ...prev, targetPath: path }))}
          />
        </div>
      ),
    },
    {
      id: 'review',
      title: 'Validation finale',
      description: 'Vérifiez les paramètres avant création',
      content: (
        <div className="space-y-4">
          <OperationPreview
            steps={[
              {
                id: 'validate',
                title: 'Validation connectivité',
                description: 'Vérification source/destination',
              },
              {
                id: 'transfer',
                title: 'Transfert sécurisé',
                description: 'Migration via SSH/rsync (nœud Tarmac, seedbox ou Storage Box)',
              },
              {
                id: 'verify',
                title: 'Contrôle final',
                description: 'Validation de la copie',
              },
            ]}
          />

          <div className="space-y-3 rounded-lg border border-white/[0.08] bg-zinc-900/60 p-4 text-sm">
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Migration:</span>
              <span className="font-mono font-semibold">{formData.name || '—'}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Source:</span>
              <span className="font-mono">
                {isRemoteKind(formData.sourceKind)
                  ? `${formData.sourceSeedboxUser || 'user'}@${formData.sourceSeedboxHost || 'seedbox'}`
                  : (nodesById[formData.sourceNodeId] ?? '—')}
              </span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-muted-foreground">Destination:</span>
              <span className="font-mono">
                {isRemoteKind(formData.targetKind)
                  ? `${formData.targetSeedboxUser || 'user'}@${formData.targetSeedboxHost || 'seedbox'}`
                  : (nodesById[formData.targetNodeId] ?? '—')}
              </span>
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
              <span className="font-mono">{selectedPreset?.name ?? 'Personnalisée'}</span>
            </div>
          </div>

          <InfoBox type="warning" title="Important">
            Évitez de lancer simultanément plusieurs migrations vers une même destination.
          </InfoBox>
        </div>
      ),
    },
  ];

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
          icon={ArrowRightLeft}
          title="Migrations"
          description="Déplacez des volumes de stockage entre nœuds, seedboxes ou Storage Boxes, avec suivi en direct."
          actions={
            <Button onClick={() => setWizardOpen(true)} className="gap-2 bg-violet-600 text-white hover:bg-violet-500">
              <Plus className="h-5 w-5" />
              Nouvelle migration
            </Button>
          }
        />

        <Callout variant="info">
          Éditable tant qu’elle est en attente, relançable après un échec. Dossiers source/destination à choisir en navigation live, sans CLI.
        </Callout>

        <div className="grid gap-3 md:grid-cols-4">
          <Card className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="text-xl font-semibold">{metrics.total}</p>
              </div>
              <ArrowRightLeft className="h-5 w-5 text-violet-300" />
            </CardContent>
          </Card>
          <Card className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-xs text-muted-foreground">En cours</p>
                <p className="text-xl font-semibold text-sky-300">{metrics.running}</p>
              </div>
              <Loader2 className="h-5 w-5 text-sky-300" />
            </CardContent>
          </Card>
          <Card className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-xs text-muted-foreground">En attente</p>
                <p className="text-xl font-semibold text-amber-300">{metrics.pending}</p>
              </div>
              <PlayCircle className="h-5 w-5 text-amber-300" />
            </CardContent>
          </Card>
          <Card className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-xs text-muted-foreground">Échecs</p>
                <p className="text-xl font-semibold text-rose-300">{metrics.failed}</p>
              </div>
              <AlertCircle className="h-5 w-5 text-rose-300" />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Migrations actives</h2>
          {activeMigrations.length === 0 ? (
            <Card className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
              <CardContent className="py-12 text-center">
                <p className="font-medium text-muted-foreground">Aucune migration active</p>
                <p className="mt-2 text-sm text-muted-foreground">Les migrations terminées sont archivées plus bas.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {activeMigrations.map((migration) => (
                <Card key={migration.id} className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <CardTitle className="text-base">{migration.name}</CardTitle>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Créée le {new Date(migration.createdAt).toLocaleDateString('fr-FR')}
                        </p>
                      </div>
                      <Badge variant={statusBadgeVariant[migration.status]}>{statusLabel[migration.status]}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4 p-6">
                    <div className="grid gap-3 rounded-lg border border-white/10 bg-zinc-950/60 p-3 md:grid-cols-2">
                      <div className="flex items-center gap-2 text-sm">
                        <Server className="h-4 w-4 text-violet-300" />
                        <span className="text-muted-foreground">Source:</span>
                        <span className="font-medium">{formatMigrationEndpoint(migration, 'source')}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <Server className="h-4 w-4 text-sky-300" />
                        <span className="text-muted-foreground">Destination:</span>
                        <span className="font-medium">{formatMigrationEndpoint(migration, 'target')}</span>
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-medium">Progression</span>
                        <span className="text-sm font-semibold">{migration.progress}%</span>
                      </div>
                      <Progress value={migration.progress} />
                    </div>

                    {migration.status === 'running' && (
                      <Alert variant="info">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <AlertDescription>Migration en cours. Vous pouvez quitter la page.</AlertDescription>
                      </Alert>
                    )}

                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span className="opacity-75">Dossier source:</span>
                        <p className="font-mono text-[11px] break-all">{migration.sourcePath ?? '—'}</p>
                      </div>
                      <div>
                        <span className="opacity-75">Dossier destination:</span>
                        <p className="font-mono text-[11px] break-all">{migration.targetPath ?? '—'}</p>
                      </div>
                    </div>

                    {migration.status === 'failed' && (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>Migration échouée. Corrigez la config puis relancez.</AlertDescription>
                      </Alert>
                    )}

                    <div className="flex flex-wrap gap-2">
                      {migration.status === 'pending' && (
                        <Button
                          onClick={() => startMigration(migration.id)}
                          disabled={busyId === migration.id}
                          className="gap-2 bg-violet-600 text-white hover:bg-violet-500"
                        >
                          {busyId === migration.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                          Lancer
                        </Button>
                      )}

                      {canEditMigration(migration) && (
                        <Button variant="outline" onClick={() => openEditDialog(migration)} disabled={busyId === migration.id} className="gap-2">
                          <Pencil className="h-4 w-4" />
                          Éditer
                        </Button>
                      )}

                      {migration.status === 'failed' && (
                        <Button variant="secondary" onClick={() => retryMigration(migration.id)} disabled={busyId === migration.id} className="gap-2">
                          {busyId === migration.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                          Relancer
                        </Button>
                      )}

                      {migration.status === 'running' && (
                        <Button
                          variant="destructive"
                          onClick={() => stopMigration(migration.id)}
                          disabled={busyId === migration.id}
                          className="gap-2"
                        >
                          {busyId === migration.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <PauseCircle className="h-4 w-4" />}
                          Arrêter
                        </Button>
                      )}

                      {canDeleteMigration(migration) && (
                        <Button variant="destructive" onClick={() => setDeleteMigration(migration)} disabled={busyId === migration.id} className="gap-2">
                          <Trash2 className="h-4 w-4" />
                          Supprimer
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        <Card className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-lg">Archives des migrations terminées</CardTitle>
          </CardHeader>
          <CardContent>
            {archivedMigrations.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune migration archivée pour le moment.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nom</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Destination</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Statut</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {archivedMigrations.map((migration) => (
                    <TableRow key={migration.id}>
                      <TableCell className="font-medium">{migration.name}</TableCell>
                      <TableCell>{formatMigrationEndpoint(migration, 'source')}</TableCell>
                      <TableCell>{formatMigrationEndpoint(migration, 'target')}</TableCell>
                      <TableCell>{new Date(migration.createdAt).toLocaleDateString('fr-FR')}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="success">Terminée</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

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

      <Dialog open={!!editMigration} onOpenChange={(open) => !open && setEditMigration(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Éditer la migration</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="mb-2 block">Nom</Label>
              <Input value={editForm.name} onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))} />
            </div>
            <div>
              <Label className="mb-2 block">Serveur source</Label>
              <Select
                value={editForm.sourceNodeId}
                onValueChange={(value) =>
                  setEditForm((prev) => ({
                    ...prev,
                    sourceNodeId: value,
                    targetNodeId: prev.targetNodeId === value ? '' : prev.targetNodeId,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choisir une source" />
                </SelectTrigger>
                <SelectContent>
                  {nodes.map((node) => (
                    <SelectItem key={node.id} value={node.id}>
                      {node.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-2 block">Serveur destination</Label>
              <Select value={editForm.targetNodeId} onValueChange={(value) => setEditForm((prev) => ({ ...prev, targetNodeId: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Choisir une destination" />
                </SelectTrigger>
                <SelectContent>
                  {nodes
                    .filter((node) => node.id !== editForm.sourceNodeId)
                    .map((node) => (
                      <SelectItem key={node.id} value={node.id}>
                        {node.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-2 block">Notes (optionnel)</Label>
              <Input value={editForm.notes} onChange={(e) => setEditForm((prev) => ({ ...prev, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditMigration(null)}>
              Annuler
            </Button>
            <Button onClick={saveEdit} disabled={!editMigration || busyId === editMigration.id}>
              {editMigration && busyId === editMigration.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Enregistrer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteMigration} onOpenChange={(open) => !open && setDeleteMigration(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer cette migration ?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Seules les migrations non lancées peuvent être supprimées. Cette action est irréversible.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteMigration(null)}>
              Annuler
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={!deleteMigration || busyId === deleteMigration.id}>
              {deleteMigration && busyId === deleteMigration.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Supprimer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
