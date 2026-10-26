'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowRight,
  BellRing,
  Crown,
  Layers,
  LogOut,
  Plus,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { api, ApiError, setCurrentWorkspaceId, WorkspaceHealth, WorkspaceListItem } from '../../lib/api';
import { BrandMark } from '../../components/BrandMark';
import { usePolling } from '../../lib/hooks/usePolling';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { CardListSkeleton } from '../../components/ui/skeleton';
import { Stat, StatRow } from '../../components/ui/stat';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';

// Two letters, always - a single stray capital in a tile reads as a broken
// image placeholder rather than a deliberate monogram. Multi-word names use
// the first letter of each of the first two words ("Acme Corp" -> "AC");
// a single-word name falls back to its own first two letters ("Intraced" ->
// "IN") instead of just "I".
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  if (words.length === 1) {
    const word = words[0];
    return word.length >= 2 ? word.slice(0, 2).toUpperCase() : (word[0] + word[0]).toUpperCase();
  }
  return '??';
}

const HEALTH: Record<WorkspaceHealth['status'], { label: string; dot: string; pill: string }> = {
  ok: { label: 'Opérationnel', dot: 'bg-[hsl(var(--ok))]', pill: 'border-[hsl(var(--ok))]/25 bg-[hsl(var(--ok))]/10 text-[hsl(var(--ok))]' },
  warning: { label: 'À surveiller', dot: 'bg-[hsl(var(--warn))]', pill: 'border-[hsl(var(--warn))]/25 bg-[hsl(var(--warn))]/10 text-[hsl(var(--warn))]' },
  critical: { label: 'Incident', dot: 'bg-[hsl(var(--danger))]', pill: 'border-[hsl(var(--danger))]/25 bg-[hsl(var(--danger))]/10 text-[hsl(var(--danger))]' },
  empty: { label: 'Aucun nœud', dot: 'bg-muted-foreground/40', pill: 'border-border bg-surface-2 text-muted-foreground' },
};

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count > 1 ? many : one}`;

export default function WorkspacesHomePage() {
  const router = useRouter();
  const { data: profile, mutate: mutateProfile } = usePolling('profile', api.profile.get, { intervalMs: 60000 });
  const { data: workspaces, isLoading, mutate } = usePolling('workspaces', api.workspaces.list, { intervalMs: 15000 });

  const quota = profile?.workspaceQuota ?? null;
  const isSuperuser = profile?.isSuperuser ?? false;
  const canCreate = (isSuperuser || profile?.canCreateWorkspaces) ?? false;
  const quotaReached = !isSuperuser && quota !== null && quota.used >= quota.limit;

  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const filtered = useMemo(() => {
    const list = workspaces ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((w) => w.name.toLowerCase().includes(q) || w.slug.toLowerCase().includes(q));
  }, [workspaces, query]);

  const totals = useMemo(() => {
    const list = workspaces ?? [];
    return {
      nodes: list.reduce((sum, w) => sum + w.health.nodesTotal, 0),
      online: list.reduce((sum, w) => sum + w.health.nodesOnline, 0),
      alerts: list.reduce((sum, w) => sum + w.health.alertsOpen, 0),
      severe: list.reduce((sum, w) => sum + w.health.alertsSevere, 0),
      attention: list.filter((w) => w.health.status === 'warning' || w.health.status === 'critical').length,
    };
  }, [workspaces]);

  // Hard navigation, not router.push - every page's data hooks are cached by
  // a plain string key (see usePolling), so a soft client-side transition
  // between two workspaces could briefly render the previous workspace's
  // cached data before revalidating. A full page load guarantees a clean
  // slate.
  const enterWorkspace = (workspace: WorkspaceListItem) => {
    setCurrentWorkspaceId(workspace.id);
    window.location.href = `/${workspace.slug}/dashboard`;
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } finally {
      router.push('/login');
    }
  };

  const count = workspaces?.length ?? 0;
  const firstName = (profile?.name || profile?.email || '').split(/[\s@]/)[0];

  // A single column of rows reads the same at one workspace as at twenty;
  // each row says at a glance whether that fleet needs attention.
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <span className="flex items-center gap-2">
            <BrandMark />
            <span className="text-sm font-semibold tracking-tight text-foreground">Tarmac</span>
          </span>
          <span className="flex items-center gap-1">
            {isSuperuser && (
              <Button variant="ghost" size="sm" asChild className="gap-2">
                <Link href="/admin">
                  <ShieldCheck className="h-4 w-4" />
                  <span className="hidden sm:inline">Administration</span>
                </Link>
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => void handleLogout()} className="gap-2">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Déconnexion</span>
            </Button>
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{firstName ? `Bonjour ${firstName}` : 'Bienvenue'}</p>
            <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-foreground">Mes workspaces</h1>
            <p className="mt-1 text-sm text-muted-foreground">Chaque workspace regroupe sa propre flotte de nœuds, ses partages et ses alertes.</p>
          </div>
          {canCreate && (
            <Button onClick={() => setCreateOpen(true)} disabled={quotaReached} className="gap-2">
              <Plus className="h-4 w-4" />
              Nouveau workspace
            </Button>
          )}
        </div>

        {count > 0 && (
          <StatRow>
            <Stat label="Workspaces" value={count} icon={Layers} hint={totals.attention > 0 ? `${totals.attention} à surveiller` : 'tous au calme'} tone={totals.attention > 0 ? 'warn' : 'neutral'} />
            <Stat
              label="Nœuds en ligne"
              value={totals.online}
              unit={`/ ${totals.nodes}`}
              icon={Server}
              tone={totals.nodes === 0 ? 'neutral' : totals.online === totals.nodes ? 'ok' : 'warn'}
              hint={totals.nodes === 0 ? 'aucun nœud pour l’instant' : totals.online === totals.nodes ? 'toute la flotte répond' : `${totals.nodes - totals.online} hors ligne`}
            />
            <Stat
              label="Alertes ouvertes"
              value={totals.alerts}
              icon={BellRing}
              tone={totals.severe > 0 ? 'danger' : totals.alerts > 0 ? 'warn' : 'ok'}
              hint={totals.severe > 0 ? `${plural(totals.severe, 'grave')}` : totals.alerts > 0 ? 'aucune grave' : 'rien à signaler'}
            />
            {!isSuperuser && quota ? (
              <QuotaTile used={quota.used} limit={quota.limit} />
            ) : (
              <Stat label="Création" value={isSuperuser ? '∞' : '—'} icon={Sparkles} tone="info" hint={isSuperuser ? 'sans limite (administrateur)' : 'non autorisée'} />
            )}
          </StatRow>
        )}

        {count > 5 && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher un workspace…" className="pl-9" />
          </div>
        )}

        <div>
          {isLoading && <CardListSkeleton cards={3} />}

          {!isLoading && count === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-surface-2">
                  <Layers className="h-6 w-6 text-muted-foreground" />
                </span>
                <div className="space-y-1.5">
                  <p className="text-base font-medium text-foreground">{canCreate ? 'Créez votre premier workspace' : 'Aucun workspace pour l’instant'}</p>
                  <p className="mx-auto max-w-md text-sm text-muted-foreground">
                    {canCreate
                      ? 'Un workspace accueille vos serveurs, leur stockage et leur réseau privé. Vous pourrez ensuite y inviter votre équipe. Si quelqu’un vous invite dans le sien, il apparaîtra aussi ici.'
                      : 'Dès qu’un administrateur vous invite dans un workspace, il apparaîtra ici. Vous recevrez aussi un email.'}
                  </p>
                </div>
                {canCreate && !quotaReached && (
                  <Button onClick={() => setCreateOpen(true)} className="mt-1 gap-2">
                    <Plus className="h-4 w-4" />
                    Créer un workspace
                  </Button>
                )}
                {!isSuperuser && quota && (
                  <p className="text-xs text-muted-foreground">
                    Vous pouvez en créer {plural(quota.limit, 'workspace')}.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {!isLoading && count > 0 && filtered.length === 0 && (
            <p className="py-16 text-center text-sm text-muted-foreground">Aucun workspace ne correspond à «&nbsp;{query}&nbsp;».</p>
          )}

          {!isLoading && filtered.length > 0 && (
            <ul className="animate-fade-in divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-1">
              {filtered.map((workspace) => (
                <li key={workspace.id}>
                  <WorkspaceRow workspace={workspace} isSuperuser={isSuperuser} onEnter={() => enterWorkspace(workspace)} />
                </li>
              ))}
            </ul>
          )}
        </div>

        {quotaReached && (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Vous avez créé tous les workspaces autorisés pour votre compte. Supprimez-en un pour libérer une place, ou demandez à un administrateur
            de la plateforme d’augmenter votre limite.
          </p>
        )}
      </main>

      <CreateWorkspaceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        quota={isSuperuser ? null : quota}
        onCreated={(workspace) => {
          setCreateOpen(false);
          void mutate();
          void mutateProfile();
          enterWorkspace(workspace);
        }}
      />
    </div>
  );
}

function QuotaTile({ used, limit }: { used: number; limit: number }) {
  const reached = used >= limit;
  const remaining = Math.max(0, limit - used);
  return (
    <div className="relative flex min-w-0 flex-col justify-between gap-3 overflow-hidden rounded-xl border border-border bg-surface-1 p-4">
      <span className={cn('absolute inset-y-0 left-0 w-px', reached ? 'bg-[hsl(var(--warn))]' : 'bg-[hsl(var(--info))]')} aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <p className="text-2xs font-medium uppercase leading-4 tracking-wider text-muted-foreground">Mes créations</p>
        <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="flex items-baseline gap-1.5">
          <span className={cn('tabular text-[1.75rem] font-semibold leading-none tracking-tight', reached ? 'text-[hsl(var(--warn))]' : 'text-foreground')}>{used}</span>
          <span className="text-sm font-medium text-muted-foreground">/ {limit}</span>
        </p>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3">
          <div
            className={cn('h-full rounded-full transition-all', reached ? 'bg-[hsl(var(--warn))]' : 'bg-primary')}
            style={{ width: `${limit > 0 ? Math.min(100, (used / limit) * 100) : 100}%` }}
          />
        </div>
        <p className={cn('mt-1.5 truncate text-xs', reached ? 'text-[hsl(var(--warn))]' : 'text-muted-foreground')}>
          {reached ? 'Limite atteinte' : `Encore ${plural(remaining, 'création possible', 'créations possibles')}`}
        </p>
      </div>
    </div>
  );
}

function WorkspaceRow({ workspace, isSuperuser, onEnter }: { workspace: WorkspaceListItem; isSuperuser: boolean; onEnter: () => void }) {
  const { health } = workspace;
  const meta = HEALTH[health.status];
  return (
    // The whole row is the control: a card whose only action is "Entrer"
    // doesn't need a separate button for it.
    <button type="button" onClick={onEnter} className="group flex w-full items-center gap-4 px-4 py-4 text-left transition-colors hover:bg-surface-2">
      <span className="relative shrink-0">
        <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-surface-2 text-xs font-semibold text-foreground">
          {initials(workspace.name)}
        </span>
        <span className={cn('absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-surface-1', meta.dot)} aria-hidden />
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{workspace.name}</span>
          {workspace.isOwner ? (
            <Badge variant="warning" className="shrink-0">
              <Crown className="h-3 w-3" />
              Propriétaire
            </Badge>
          ) : workspace.myRole === 'owner' && !isSuperuser ? (
            <Badge variant="info" className="shrink-0">
              <ShieldCheck className="h-3 w-3" />
              Administrateur
            </Badge>
          ) : null}
          {workspace.isDefault && (
            <Badge variant="outline" className="shrink-0">
              Par défaut
            </Badge>
          )}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="truncate font-mono">/{workspace.slug}</span>
          <span className="flex shrink-0 items-center gap-1">
            <Server className="h-3 w-3" />
            {health.nodesTotal === 0 ? 'aucun nœud' : `${health.nodesOnline}/${health.nodesTotal} en ligne`}
          </span>
          {health.alertsOpen > 0 && (
            <span className={cn('flex shrink-0 items-center gap-1', health.alertsSevere > 0 ? 'text-[hsl(var(--danger))]' : 'text-[hsl(var(--warn))]')}>
              <BellRing className="h-3 w-3" />
              {plural(health.alertsOpen, 'alerte')}
            </span>
          )}
          <span className="flex shrink-0 items-center gap-1">
            <Users className="h-3 w-3" />
            {plural(workspace.memberCount, 'membre')}
          </span>
        </span>
      </span>

      <span className={cn('hidden shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-medium sm:inline-flex', meta.pill)}>
        <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
        {meta.label}
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
    </button>
  );
}

function slugPreview(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function CreateWorkspaceDialog({
  open,
  onOpenChange,
  quota,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quota: { used: number; limit: number } | null;
  onCreated: (workspace: WorkspaceListItem) => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName('');
      setSlug('');
      setError(null);
    }
  }, [open]);

  const finalSlug = slugPreview(slug || name);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const created = await api.workspaces.create({ name: name.trim(), slug: slug.trim() || undefined });
      onCreated(created as WorkspaceListItem);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? err.message
          : 'Impossible de créer ce workspace : ce nom ou cette adresse est peut-être déjà utilisé. Essayez-en un autre.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nouveau workspace</DialogTitle>
          <DialogDescription>Vous en serez le propriétaire et pourrez y inviter votre équipe ensuite.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="workspace-name">Nom</Label>
            <Input id="workspace-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoFocus placeholder="Production, Lab, Client Dupont…" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="workspace-slug">
              Adresse <span className="font-normal text-muted-foreground">(facultatif)</span>
            </Label>
            <Input id="workspace-slug" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder={slugPreview(name) || 'déduite du nom'} className="font-mono" spellCheck={false} />
            <p className="truncate text-xs text-muted-foreground">
              <span className="font-mono">
                {origin}/<span className="text-foreground">{finalSlug || '…'}</span>/dashboard
              </span>
            </p>
          </div>
          {quota && (
            <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted-foreground">
              Ce sera votre {quota.used + 1 === 1 ? '1er' : `${quota.used + 1}e`} workspace sur les {quota.limit} que votre compte peut créer.
            </p>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={loading || name.trim().length < 2} className="gap-2">
              {loading ? 'Création…' : 'Créer le workspace'}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
