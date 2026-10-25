'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { Ban, Check, Copy, KeyRound, LoaderCircle, Plus, ShieldAlert, Terminal, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Callout } from '@/components/Callout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusPill } from '@/components/ui/status';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableRowSkeleton } from '@/components/ui/skeleton';
import { api, API_BASE, ApiKeyItem, ApiKeyScope } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { usePolling } from '@/lib/hooks/usePolling';
import { useWorkspace } from '@/lib/workspace-context';
import { cn } from '@/lib/utils';

const SCOPES: Array<{ value: ApiKeyScope; label: string; description: string }> = [
  {
    value: 'vpn:read',
    label: 'VPN — lecture',
    description: 'Lister les profils, leur état de connexion et les passerelles.',
  },
  {
    value: 'vpn:write',
    label: 'VPN — gestion',
    description: 'Créer, modifier, basculer la sortie, supprimer et télécharger les configurations (clés privées incluses).',
  },
];

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

function CopyButton({ value, label = 'Copier' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      className="gap-1.5"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-[hsl(var(--ok))]" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copié' : label}
    </Button>
  );
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
  return {
    list: `curl -s ${base}/vpn/profiles \\\n  -H "Authorization: Bearer ${token}"`,
    create: `curl -s -X POST ${base}/vpn/profiles \\\n  -H "Authorization: Bearer ${token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"laptop-lea","entryNodeId":"<ID_NOEUD_ENTREE>","exitNodeId":"<ID_NOEUD_SORTIE>"}'`,
    switchExit: `curl -s -X POST ${base}/vpn/profiles/<ID_PROFIL>/exit \\\n  -H "Authorization: Bearer ${token}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"exitNodeId":"<ID_NOEUD_SORTIE>"}'`,
    config: `curl -OJ ${base}/vpn/profiles/<ID_PROFIL>/config.conf \\\n  -H "Authorization: Bearer ${token}"`,
  };
}

function CreateKeyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiKeyScope[]>(['vpn:read']);
  const [expiry, setExpiry] = useState('90');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setScopes(['vpn:read']);
    setExpiry('90');
    setError(null);
    setToken(null);
  }, [open]);

  const toggleScope = (scope: ApiKeyScope) =>
    setScopes((current) => (current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope]));

  const create = async () => {
    setSaving(true);
    setError(null);
    try {
      const created = await api.apiKeys.create({
        name: name.trim(),
        scopes,
        expiresAt: expiry === 'never' ? undefined : new Date(Date.now() + Number(expiry) * 86_400_000).toISOString(),
      });
      setToken(created.token);
      onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'La création de la clé a échoué.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
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
                nouvelle.
              </Callout>
              <CodeBlock title="Essayer la clé" code={examples(token).list} />
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>J&apos;ai copié la clé</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Nouvelle clé API</DialogTitle>
              <DialogDescription>
                La clé agit uniquement sur ce workspace, avec les permissions choisies ci-dessous.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
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
                      {EXPIRY.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Permissions</Label>
                <div className="space-y-2">
                  {SCOPES.map((scope) => {
                    const checked = scopes.includes(scope.value);
                    return (
                      <label
                        key={scope.value}
                        className={cn(
                          'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                          checked ? 'border-primary/50 bg-primary/[0.06]' : 'border-border bg-surface-2 hover:border-primary/30',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleScope(scope.value)}
                          className="mt-0.5 h-4 w-4 rounded"
                        />
                        <span>
                          <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                            {scope.label}
                            <code className="font-mono text-2xs text-muted-foreground">{scope.value}</code>
                          </span>
                          <span className="block text-xs text-muted-foreground">{scope.description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
              {error && <Callout variant="danger">{error}</Callout>}
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Annuler
              </Button>
              <Button onClick={() => void create()} disabled={saving || !name.trim() || scopes.length === 0} className="gap-1.5">
                {saving && <LoaderCircle className="h-4 w-4 animate-spin" />}
                Créer la clé
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
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (action: () => Promise<unknown>) => {
    setError(null);
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
            <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
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
                              <span className="flex flex-wrap gap-1">
                                {key.scopes.map((scope) => (
                                  <Badge key={scope} variant="secondary" className="font-mono">
                                    {scope}
                                  </Badge>
                                ))}
                              </span>
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
                  <Button variant="secondary" onClick={() => setCreateOpen(true)} className="gap-1.5">
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
                Passez la clé dans l&apos;en-tête <code className="font-mono">Authorization: Bearer</code>. Les identifiants
                de nœuds sont disponibles via <code className="font-mono">GET /vpn/gateways</code>. Référence complète
                dans la documentation API.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-2">
              <CodeBlock title="Créer un profil (entrée + sortie)" code={sample.create} />
              <CodeBlock title="Changer la sortie à chaud" code={sample.switchExit} />
              <CodeBlock title="Télécharger la configuration" code={sample.config} />
              <CodeBlock title="Lister les profils et leur état" code={sample.list} />
            </CardContent>
          </Card>
        </>
      )}

      <CreateKeyDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => void mutate()} />
    </div>
  );
}
