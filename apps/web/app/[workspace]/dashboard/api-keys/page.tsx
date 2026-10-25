'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { Ban, BookOpen, Eye, KeyRound, LoaderCircle, Pencil, Plus, ShieldAlert, Terminal, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/PageHeader';
import { Callout } from '@/components/Callout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusPill } from '@/components/ui/status';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TableRowSkeleton } from '@/components/ui/skeleton';
import { api, API_BASE, ApiKeyItem } from '@/lib/api';
import {
  API_KEY_RESOURCES,
  PermissionMap,
  permissionsToScopes,
  presetOf,
  readOnlyPermissions,
  scopesToPermissions,
} from '@/lib/api-key-permissions';
import { formatDateTime, formatRelative } from '@/lib/format';
import { usePolling } from '@/lib/hooks/usePolling';
import { useWorkspace } from '@/lib/workspace-context';
import { cn } from '@/lib/utils';
import { PermissionEditor } from './components/PermissionEditor';

const EXPIRY = [
  { value: 'never', label: 'Jamais' },
  { value: '30', label: '30 jours' },
  { value: '90', label: '90 jours' },
  { value: '365', label: '1 an' },
];

function keyState(key: ApiKeyItem): { tone: 'ok' | 'neutral' | 'danger'; label: string } {
  if (key.revokedAt) return { tone: 'danger', label: 'Révoquée' };
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now()) return { tone: 'neutral', label: 'Expirée' };
  return { tone: 'ok', label: 'Active' };
}

function CodeBlock({ title, code }: { title: string; code: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface-2">
      <div className="flex items-center justify-between gap-2 border-b border-border py-1.5 pl-3 pr-1.5">
        <span className="truncate text-xs font-medium text-foreground">{title}</span>
        <CopyButton value={code} />
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 font-mono text-2xs leading-relaxed text-foreground/90">{code}</pre>
    </div>
  );
}

function examples(token: string) {
  const base = `${API_BASE}/api/v1`;
  const auth = `-H "Authorization: Bearer ${token}"`;
  const json = `${auth} \\\n  -H "Content-Type: application/json"`;
  return {
    nodes: `curl -s ${base}/nodes \\\n  ${auth}`,
    dnsRecord: `curl -s -X POST ${base}/dns/zones/<ID_ZONE>/records \\\n  ${json} \\\n  -d '{"name":"www","type":"A","ttl":300,"values":[{"content":"203.0.113.10"}]}'`,
    vpnCreate: `curl -s -X POST ${base}/vpn/profiles \\\n  ${json} \\\n  -d '{"name":"laptop-lea","entryNodeId":"<ID_NOEUD_ENTREE>","exitNodeId":"<ID_NOEUD_SORTIE>"}'`,
    switchExit: `curl -s -X POST ${base}/vpn/profiles/<ID_PROFIL>/exit \\\n  ${json} \\\n  -d '{"exitNodeId":"<ID_NOEUD_SORTIE>"}'`,
    alerts: `curl -s ${base}/alerts \\\n  ${auth}`,
    config: `curl -OJ ${base}/vpn/profiles/<ID_PROFIL>/config.conf \\\n  ${auth}`,
  };
}

const EDIT_EXPIRY = [{ value: 'keep', label: 'Inchangée' }, ...EXPIRY.map((option) => ({ ...option, label: option.value === 'never' ? 'Jamais' : `Dans ${option.label}` }))];

function expiryIso(value: string): string | null {
  return value === 'never' ? null : new Date(Date.now() + Number(value) * 86_400_000).toISOString();
}

/** What a key can do, in one glance: a preset name, or the modules it opens. */
function PermissionSummary({ scopes }: { scopes: readonly string[] }) {
  const permissions = scopesToPermissions(scopes);
  const preset = presetOf(permissions);
  if (preset === 'full') return <Badge variant="info">Accès complet</Badge>;
  if (preset === 'read') return <Badge variant="secondary">Lecture seule</Badge>;
  const granted = API_KEY_RESOURCES.filter((resource) => permissions[resource.id] !== 'none');
  if (granted.length === 0) return <span className="text-xs text-muted-foreground">Aucune</span>;
  const shown = granted.slice(0, 3);
  const chips = (
    <span className="flex flex-wrap gap-1">
      {shown.map((resource) => {
        const LevelIcon = permissions[resource.id] === 'write' ? Pencil : Eye;
        return (
          <Badge key={resource.id} variant="secondary" className="gap-1">
            <LevelIcon className="h-3 w-3 text-muted-foreground" />
            {resource.label}
          </Badge>
        );
      })}
      {granted.length > shown.length && <Badge variant="outline">+{granted.length - shown.length}</Badge>}
    </span>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{chips}</span>
      </TooltipTrigger>
      <TooltipContent className="space-y-0.5">
        {granted.map((resource) => (
          <p key={resource.id}>
            {resource.label} : {permissions[resource.id] === 'write' ? 'lecture et écriture' : 'lecture'}
          </p>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

function KeyDialog({
  open,
  editing,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  /** Set to edit an existing key; null creates a new one. */
  editing: ApiKeyItem | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (message?: string) => void;
}) {
  const [name, setName] = useState('');
  const [permissions, setPermissions] = useState<PermissionMap>(readOnlyPermissions());
  const [expiry, setExpiry] = useState('90');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? '');
    setPermissions(editing ? scopesToPermissions(editing.scopes) : readOnlyPermissions());
    setExpiry(editing ? 'keep' : '90');
    setError(null);
    setToken(null);
  }, [open, editing]);

  const scopes = permissionsToScopes(permissions);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await api.apiKeys.update(editing.id, {
          name: name.trim(),
          scopes,
          ...(expiry === 'keep' ? {} : { expiresAt: expiryIso(expiry) }),
        });
        onSaved(`Clé « ${name.trim()} » mise à jour : les nouvelles permissions s'appliquent dès le prochain appel.`);
        onOpenChange(false);
      } else {
        const created = await api.apiKeys.create({
          name: name.trim(),
          scopes,
          expiresAt: expiryIso(expiry) ?? undefined,
        });
        setToken(created.token);
        onSaved();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "L'enregistrement de la clé a échoué.");
    } finally {
      setSaving(false);
    }
  };

  const expiryOptions = editing ? EDIT_EXPIRY : EXPIRY;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        {token ? (
          <>
            <DialogHeader>
              <DialogTitle>Clé « {name.trim()} » créée</DialogTitle>
              <DialogDescription>Copiez-la maintenant : elle ne sera plus jamais affichée.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/[0.06] p-3">
                <code className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">{token}</code>
                <CopyButton value={token} />
              </div>
              <Callout variant="warning">
                Tarmac ne conserve qu&apos;une empreinte de cette clé. En cas de perte, révoquez-la et créez-en une
                nouvelle. Ses permissions et son expiration restent modifiables à tout moment.
              </Callout>
              <CodeBlock
                title="Essayer la clé"
                code={permissions.nodes !== 'none' || permissions.vpn === 'none' ? examples(token).nodes : `curl -s ${API_BASE}/api/v1/vpn/profiles \\\n  -H "Authorization: Bearer ${token}"`}
              />
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>J&apos;ai copié la clé</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{editing ? `Modifier « ${editing.name} »` : 'Nouvelle clé API'}</DialogTitle>
              <DialogDescription>
                {editing
                  ? 'La clé garde le même secret : vos intégrations continuent de fonctionner avec les nouvelles permissions.'
                  : 'La clé agit uniquement sur ce workspace, avec les permissions choisies ci-dessous.'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-[1fr_13rem]">
                <div className="space-y-2">
                  <Label htmlFor="api-key-name">Nom</Label>
                  <Input
                    id="api-key-name"
                    value={name}
                    autoFocus
                    maxLength={80}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Ex. Provisioning intranet"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="api-key-expiry">Expiration</Label>
                  <Select value={expiry} onValueChange={setExpiry}>
                    <SelectTrigger id="api-key-expiry">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {expiryOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.value === 'keep' && editing
                            ? `Inchangée (${editing.expiresAt ? formatDateTime(editing.expiresAt) : 'jamais'})`
                            : option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Permissions</Label>
                <PermissionEditor value={permissions} onChange={setPermissions} />
              </div>
              {error && <Callout variant="danger">{error}</Callout>}
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Annuler
              </Button>
              <Button
                onClick={() => void save()}
                disabled={saving || !name.trim() || scopes.length === 0}
                title={scopes.length === 0 ? 'Accordez au moins une permission.' : undefined}
                className="gap-1.5"
              >
                {saving && <LoaderCircle className="h-4 w-4 animate-spin" />}
                {editing ? 'Enregistrer' : 'Créer la clé'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function ApiKeysPage() {
  const { currentWorkspaceId, isPlatformAdmin, isLoading: workspaceLoading } = useWorkspace();
  // Only list() carries the caller's own role per workspace.
  const { data: workspaces } = useSWR('workspaces-with-role', api.workspaces.list);
  const myRole = workspaces?.find((workspace) => workspace.id === currentWorkspaceId)?.myRole;
  const isManager = isPlatformAdmin || myRole === 'owner';
  const roleKnown = !workspaceLoading && (isPlatformAdmin || workspaces !== undefined);

  const { data: keys = [], mutate, isLoading } = usePolling(isManager ? 'api-keys' : null, api.apiKeys.list, {
    intervalMs: 30000,
  });
  const [dialog, setDialog] = useState<{ open: boolean; editing: ApiKeyItem | null }>({ open: false, editing: null });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const openCreate = () => setDialog({ open: true, editing: null });

  const act = async (action: () => Promise<unknown>) => {
    setError(null);
    setNotice(null);
    try {
      await action();
      await mutate();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "L'action a échoué.");
    }
  };

  const sample = examples('$TARMAC_API_KEY');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clés API"
        description="Automatisez Tarmac depuis vos propres outils. Chaque clé est rattachée à ce workspace et limitée aux permissions choisies."
        actions={
          isManager ? (
            <Button onClick={openCreate} className="gap-1.5">
              <Plus className="h-4 w-4" />
              Nouvelle clé
            </Button>
          ) : undefined
        }
      />

      {roleKnown && !isManager ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <ShieldAlert className="h-8 w-8 text-[hsl(var(--warn))]" />
            <h2 className="text-base font-semibold text-foreground">Réservé aux gérants du workspace</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              Seuls les propriétaires du workspace (et les administrateurs de la plateforme) peuvent créer ou révoquer
              des clés API. Demandez à l&apos;un d&apos;eux si vous avez besoin d&apos;un accès programmatique.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {error && <Callout variant="danger">{error}</Callout>}
          {notice && <Callout variant="success">{notice}</Callout>}

          <Card>
            <CardHeader>
              <CardTitle>
                <KeyRound className="h-4 w-4 text-muted-foreground" />
                Clés du workspace
              </CardTitle>
            </CardHeader>
            <CardContent flush>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nom</TableHead>
                    <TableHead>Clé</TableHead>
                    <TableHead>Permissions</TableHead>
                    <TableHead>Dernière utilisation</TableHead>
                    <TableHead>Expiration</TableHead>
                    <TableHead>État</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading || !roleKnown
                    ? Array.from({ length: 2 }).map((_, index) => <TableRowSkeleton key={index} columns={7} />)
                    : keys.map((key) => {
                        const state = keyState(key);
                        return (
                          <TableRow key={key.id} className={cn(state.label !== 'Active' && 'opacity-60')}>
                            <TableCell>
                              <span className="block text-sm font-medium text-foreground">{key.name}</span>
                              <span className="block text-2xs text-muted-foreground">
                                Créée {formatRelative(key.createdAt)}
                                {key.createdBy ? ` par ${key.createdBy.name ?? key.createdBy.email}` : ''}
                              </span>
                            </TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">tmk_{key.prefix}_••••</TableCell>
                            <TableCell>
                              <PermissionSummary scopes={key.scopes} />
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground" title={key.lastUsedIp ?? undefined}>
                              {key.lastUsedAt ? formatRelative(key.lastUsedAt) : 'Jamais'}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {key.expiresAt ? formatDateTime(key.expiresAt) : 'Jamais'}
                            </TableCell>
                            <TableCell>
                              <StatusPill tone={state.tone}>{state.label}</StatusPill>
                            </TableCell>
                            <TableCell className="text-right">
                              <span className="inline-flex gap-1">
                                {!key.revokedAt && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="gap-1.5"
                                    onClick={() => setDialog({ open: true, editing: key })}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                    Modifier
                                  </Button>
                                )}
                                {!key.revokedAt && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="gap-1.5"
                                    onClick={() => {
                                      if (window.confirm(`Révoquer « ${key.name} » ? Les appels utilisant cette clé seront refusés immédiatement.`)) {
                                        void act(() => api.apiKeys.revoke(key.id));
                                      }
                                    }}
                                  >
                                    <Ban className="h-3.5 w-3.5" />
                                    Révoquer
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Supprimer ${key.name}`}
                                  className="text-[hsl(var(--danger))]"
                                  onClick={() => {
                                    if (window.confirm(`Supprimer définitivement « ${key.name} » ?`)) {
                                      void act(() => api.apiKeys.remove(key.id));
                                    }
                                  }}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </span>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                </TableBody>
              </Table>
              {!isLoading && roleKnown && keys.length === 0 && (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <KeyRound className="h-6 w-6 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Aucune clé API pour l&apos;instant.</p>
                  <Button variant="secondary" onClick={openCreate} className="gap-1.5">
                    <Plus className="h-4 w-4" />
                    Créer une clé
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <Terminal className="h-4 w-4 text-muted-foreground" />
                Démarrage rapide
              </CardTitle>
              <CardDescription>
                Passez la clé dans l&apos;en-tête <code className="font-mono">Authorization: Bearer</code>, sans
                <code className="font-mono"> X-Workspace-Id</code> : elle est déjà liée à ce workspace. Chaque route de la
                référence API indique la permission qu&apos;elle demande.
              </CardDescription>
              <Button variant="secondary" size="sm" asChild>
                <Link href="/docs/api" className="gap-1.5">
                  <BookOpen className="h-3.5 w-3.5" />
                  Référence API
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-2">
              <CodeBlock title="Lister les nœuds · nodes:read" code={sample.nodes} />
              <CodeBlock title="Ajouter un enregistrement DNS · dns:write" code={sample.dnsRecord} />
              <CodeBlock title="Créer un profil VPN · vpn:write" code={sample.vpnCreate} />
              <CodeBlock title="Changer la sortie à chaud · vpn:write" code={sample.switchExit} />
              <CodeBlock title="Alertes en cours · alerts:read" code={sample.alerts} />
              <CodeBlock title="Télécharger une configuration VPN · vpn:write" code={sample.config} />
            </CardContent>
          </Card>
        </>
      )}

      <KeyDialog
        open={dialog.open}
        editing={dialog.editing}
        onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}
        onSaved={(message) => {
          if (message) setNotice(message);
          void mutate();
        }}
      />
    </div>
  );
}
