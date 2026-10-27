'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { CheckCircle2, GitBranch, KeyRound, LoaderCircle, RefreshCw, Server, Trash2, TriangleAlert, Unplug } from 'lucide-react';
import { api, ApiError, GithubDeployKeyOverview } from '../../lib/api';
import { formatRelative } from '../../lib/format';
import { cn } from '../../lib/utils';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';

const errorMessage = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/**
 * The GitHub repository nodes clone Tarmac from: Tarmac adds each new
 * node's deploy key there and removes it when the node is deleted.
 */
export function GithubPanel() {
  const [overview, setOverview] = useState<GithubDeployKeyOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setOverview(await api.admin.github());
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err, 'Impossible de charger l’intégration GitHub.'));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!overview) {
    return loadError ? (
      <Alert variant="destructive">
        <AlertDescription>{loadError}</AlertDescription>
      </Alert>
    ) : (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        Chargement…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ConnectionCard overview={overview} onSaved={setOverview} onDisconnected={() => void load()} />
      {overview.configured && <NodeKeysCard overview={overview} refreshing={refreshing} onRefresh={() => void load()} onChanged={setOverview} />}
    </div>
  );
}

function ConnectionCard({
  overview,
  onSaved,
  onDisconnected,
}: {
  overview: GithubDeployKeyOverview;
  onSaved: (next: GithubDeployKeyOverview) => void;
  onDisconnected: () => void;
}) {
  const [editing, setEditing] = useState(!overview.configured);
  const [repository, setRepository] = useState(overview.repository ?? 'enzogh/Tarmac');
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const state = !overview.configured ? 'off' : overview.lastError || !overview.reachable ? 'error' : 'ok';

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      onSaved(await api.admin.configureGithub({ repository: repository.trim(), ...(token.trim() ? { token: token.trim() } : {}) }));
      setToken('');
      setEditing(false);
    } catch (err) {
      setError(errorMessage(err, 'GitHub n’a pas pu être joint.'));
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    setSaving(true);
    try {
      await api.admin.disconnectGithub();
      setConfirmDisconnect(false);
      setEditing(true);
      onDisconnected();
    } catch (err) {
      setError(errorMessage(err, 'La déconnexion a échoué.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--info))]/10 text-[hsl(var(--info))]">
              <GitBranch className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Dépôt GitHub des nœuds</p>
              <p className="text-xs text-muted-foreground">
                Chaque nœud récupère Tarmac et ses mises à jour avec sa propre clé de déploiement, en lecture seule. Tarmac l’ajoute au dépôt quand
                un nœud est créé et la retire quand il est supprimé.
              </p>
            </div>
          </div>
          <Badge variant={state === 'ok' ? 'success' : state === 'error' ? 'destructive' : 'secondary'}>
            {state === 'ok' ? 'Connecté' : state === 'error' ? 'En erreur' : 'Non configuré'}
          </Badge>
        </div>

        {!overview.secretsKeyConfigured && (
          <Alert variant="warning">
            <TriangleAlert className="h-4 w-4" />
            <AlertDescription>
              La clé de chiffrement des secrets (TARMAC_SECRETS_KEY) n’est pas configurée : le jeton serait enregistré en clair. Redéployez avec
              docker/deploy.sh, qui la génère.
            </AlertDescription>
          </Alert>
        )}

        {editing ? (
          <form onSubmit={(event) => void save(event)} className="space-y-4">
            <div className="space-y-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Créer le jeton</p>
              <ol className="list-decimal space-y-1 pl-4">
                <li>
                  Sur GitHub : Settings → Developer settings → Personal access tokens → <span className="text-foreground">Fine-grained tokens</span> →
                  Generate new token.
                </li>
                <li>
                  Repository access : <span className="text-foreground">Only select repositories</span>, choisissez le dépôt de Tarmac.
                </li>
                <li>
                  Permissions → Repository permissions → <span className="text-foreground">Administration : Read and write</span> (c’est elle qui
                  donne accès aux clés de déploiement). Rien d’autre.
                </li>
                <li>Copiez le jeton ici : il est chiffré en base et n’est plus jamais réaffiché.</li>
              </ol>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-foreground">Dépôt</span>
                <Input value={repository} onChange={(event) => setRepository(event.target.value)} placeholder="propriétaire/nom" className="font-mono" />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium text-foreground">Jeton d’accès</span>
                <Input
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder={overview.tokenHint ? `Inchangé (${overview.tokenHint})` : 'github_pat_…'}
                  className="font-mono"
                />
              </label>
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              {overview.configured && (
                <Button type="button" variant="secondary" onClick={() => setEditing(false)} disabled={saving}>
                  Annuler
                </Button>
              )}
              <Button type="submit" disabled={saving || !repository.trim() || (!overview.configured && !token.trim())} className="gap-1.5">
                {saving && <LoaderCircle className="h-4 w-4 animate-spin" />}
                Vérifier et enregistrer
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-2 p-3 text-xs">
            <span className="font-mono text-foreground">{overview.repository}</span>
            <span className="text-muted-foreground">jeton {overview.tokenHint}</span>
            <span className="text-muted-foreground">
              {overview.lastSyncAt ? `· synchronisé ${formatRelative(overview.lastSyncAt)}` : ''}
            </span>
            <span className="flex-1" />
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              Modifier
            </Button>
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => setConfirmDisconnect(true)}>
              <Unplug className="h-3.5 w-3.5" />
              Déconnecter
            </Button>
          </div>
        )}

        {!editing && overview.lastError && (
          <Alert variant="destructive">
            <AlertDescription>{overview.lastError}</AlertDescription>
          </Alert>
        )}
      </CardContent>

      <Dialog open={confirmDisconnect} onOpenChange={(open) => !saving && setConfirmDisconnect(open)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Déconnecter GitHub ?</DialogTitle>
            <DialogDescription>
              Le jeton est effacé de Tarmac. Les clés déjà sur GitHub restent en place et les nœuds continuent de fonctionner, mais les prochains
              nœuds demanderont d’ajouter leur clé à la main, et celles des nœuds supprimés resteront sur GitHub.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmDisconnect(false)} disabled={saving}>
              Annuler
            </Button>
            <Button variant="destructive" onClick={() => void disconnect()} disabled={saving} className="gap-1.5">
              {saving && <LoaderCircle className="h-4 w-4 animate-spin" />}
              Déconnecter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

const KEY_STATUS: Record<GithubDeployKeyOverview['nodes'][number]['keyStatus'], { label: string; variant: 'success' | 'warning' | 'secondary' }> = {
  on_github: { label: 'Sur GitHub', variant: 'success' },
  missing: { label: 'Absente de GitHub', variant: 'warning' },
  unknown: { label: 'Clé non signalée', variant: 'secondary' },
};

function NodeKeysCard({
  overview,
  refreshing,
  onRefresh,
  onChanged,
}: {
  overview: GithubDeployKeyOverview;
  refreshing: boolean;
  onRefresh: () => void;
  onChanged: (next: GithubDeployKeyOverview) => void;
}) {
  const [deleting, setDeleting] = useState<GithubDeployKeyOverview['orphanKeys'][number] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onGithub = overview.nodes.filter((node) => node.keyStatus === 'on_github').length;

  const deleteKey = async () => {
    if (!deleting) return;
    setBusy(true);
    setError(null);
    try {
      onChanged(await api.admin.deleteGithubKey(deleting.id));
      setDeleting(null);
    } catch (err) {
      setError(errorMessage(err, 'La suppression a échoué.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <KeyRound className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Clés de déploiement des nœuds</p>
              <p className="text-xs text-muted-foreground">
                {onGithub} nœud{onGithub > 1 ? 's' : ''} sur {overview.nodes.length} avec sa clé sur GitHub, tous workspaces confondus. Vérifié
                toutes les 15 minutes : une clé signalée par un nœud mais absente de GitHub y est ajoutée.
              </p>
            </div>
          </div>
          <Button variant="secondary" size="sm" className="gap-1.5" disabled={refreshing} onClick={onRefresh}>
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            Synchroniser
          </Button>
        </div>

        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {overview.nodes.map((node) => {
            const status = KEY_STATUS[node.keyStatus];
            return (
              <div key={node.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-surface-2 px-3 py-2.5 text-sm">
                <Server className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate font-medium text-foreground">{node.name}</span>
                <span className="truncate text-xs text-muted-foreground">{node.workspace.name}</span>
                <span className="flex-1" />
                {node.fingerprint && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="hidden max-w-[11rem] truncate font-mono text-2xs text-muted-foreground sm:inline">{node.fingerprint}</span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {node.githubKey?.title ? `Sur GitHub sous « ${node.githubKey.title} »` : 'Empreinte de la clé du nœud'}
                    </TooltipContent>
                  </Tooltip>
                )}
                <Badge variant={status.variant}>{status.label}</Badge>
              </div>
            );
          })}
        </div>
        {overview.nodes.some((node) => node.keyStatus === 'unknown') && (
          <p className="text-xs text-muted-foreground">
            « Clé non signalée » : l’agent du nœud n’a pas encore remonté sa clé (mettez-le à jour), ou le nœud n’a pas été installé avec une clé
            de déploiement.
          </p>
        )}

        {overview.orphanKeys.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">Clés sur GitHub sans nœud correspondant</p>
            <p className="text-xs text-muted-foreground">
              Elles ne sont jamais supprimées automatiquement : elles peuvent servir à autre chose (intégration continue, poste de développement).
            </p>
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {overview.orphanKeys.map((key) => (
                <div key={key.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-surface-2 px-3 py-2.5 text-sm">
                  <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate text-foreground">{key.title}</span>
                  {!key.readOnly && <Badge variant="warning">Écriture</Badge>}
                  <span className="flex-1" />
                  {key.createdAt && <span className="text-xs text-muted-foreground">ajoutée {formatRelative(key.createdAt)}</span>}
                  <Button variant="ghost" size="icon" className="text-rose-300 hover:text-rose-200" onClick={() => setDeleting(key)} aria-label={`Supprimer ${key.title}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
        {overview.orphanKeys.length === 0 && overview.reachable && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--ok))]" />
            Toutes les clés du dépôt appartiennent à un nœud.
          </p>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>

      <Dialog open={!!deleting} onOpenChange={(open) => !busy && !open && setDeleting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Supprimer « {deleting?.title} » de GitHub ?</DialogTitle>
            <DialogDescription>
              Tout ce qui utilise cette clé ne pourra plus accéder au dépôt {overview.repository}. Aucun nœud Tarmac ne la signale.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={busy}>
              Annuler
            </Button>
            <Button variant="destructive" onClick={() => void deleteKey()} disabled={busy} className="gap-1.5">
              {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
              Supprimer la clé
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
