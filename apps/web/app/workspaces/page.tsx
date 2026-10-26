'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Layers, LogOut, Plus, Search, ShieldCheck, Users } from 'lucide-react';
import { api, ApiError, setCurrentWorkspaceId, WorkspaceListItem } from '../../lib/api';
import { BrandMark } from '../../components/BrandMark';
import { usePolling } from '../../lib/hooks/usePolling';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { CardListSkeleton } from '../../components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';

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

export default function WorkspacesHomePage() {
  const router = useRouter();
  const { data: profile, mutate: mutateProfile } = usePolling('profile', api.profile.get, { intervalMs: 60000 });
  const { data: workspaces, isLoading, mutate } = usePolling('workspaces', api.workspaces.list, { intervalMs: 15000 });

  const quota = profile?.workspaceQuota ?? null;
  const canCreate = (profile?.isSuperuser || profile?.canCreateWorkspaces) ?? false;
  const quotaReached = !profile?.isSuperuser && quota !== null && quota.used >= quota.limit;

  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const filtered = useMemo(() => {
    const list = workspaces ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((w) => w.name.toLowerCase().includes(q) || w.slug.toLowerCase().includes(q));
  }, [workspaces, query]);

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

  // A three-column card grid with per-workspace gradient tiles was built for
  // a page that in practice holds one or two entries: it left a single small
  // card marooned in an empty grid, and six rotating gradients put more
  // colour on this screen than on any dashboard behind it. A single column
  // of rows reads the same at one workspace as at twenty.
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-6 py-4">
          <span className="flex items-center gap-2">
            <BrandMark />
            <span className="text-sm font-semibold tracking-tight text-foreground">Tarmac</span>
          </span>
          <span className="flex items-center gap-1">
            {profile?.isSuperuser && (
              <Button variant="ghost" size="sm" asChild className="gap-2">
                <Link href="/admin">
                  <ShieldCheck className="h-4 w-4" />
                  Administration
                </Link>
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => void handleLogout()} className="gap-2">
              <LogOut className="h-4 w-4" />
              Déconnexion
            </Button>
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Mes workspaces</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Chaque workspace regroupe sa propre flotte de nœuds, ses partages et ses alertes.
            </p>
          </div>
          {canCreate && (
            <div className="flex flex-col items-end gap-1">
              <Button onClick={() => setCreateOpen(true)} disabled={quotaReached} className="gap-2">
                <Plus className="h-4 w-4" />
                Nouveau workspace
              </Button>
              {!profile?.isSuperuser && quota && (
                <span className="text-xs text-muted-foreground">
                  {quotaReached
                    ? `Limite atteinte : ${quota.limit} workspace${quota.limit > 1 ? 's' : ''} créé${quota.limit > 1 ? 's' : ''}`
                    : `${quota.used} sur ${quota.limit} créé${quota.limit > 1 ? 's' : ''}`}
                </span>
              )}
            </div>
          )}
        </div>

        {count > 5 && (
          <div className="relative mt-6">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un workspace…"
              className="pl-9"
            />
          </div>
        )}

        <div className="mt-6">
          {isLoading && <CardListSkeleton cards={3} />}

          {!isLoading && count === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
                <Layers className="h-7 w-7 text-muted-foreground" />
                <p className="max-w-sm text-sm text-muted-foreground">
                  {canCreate
                    ? 'Aucun workspace pour l’instant. Crée le tien, ou attends qu’on t’invite dans un workspace existant.'
                    : 'Aucun workspace accessible. Contacte un administrateur pour qu’il t’y ajoute.'}
                </p>
                {canCreate && !quotaReached && (
                  <Button onClick={() => setCreateOpen(true)} variant="outline" className="mt-1 gap-2">
                    <Plus className="h-4 w-4" />
                    Créer un workspace
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {!isLoading && count > 0 && filtered.length === 0 && (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Aucun workspace ne correspond à «&nbsp;{query}&nbsp;».
            </p>
          )}

          {!isLoading && filtered.length > 0 && (
            <ul className="animate-fade-in divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-1">
              {filtered.map((workspace) => (
                <li key={workspace.id}>
                  {/* The whole row is the control: a card whose only action
                      is "Entrer" doesn't need a separate button for it. */}
                  <button
                    type="button"
                    onClick={() => enterWorkspace(workspace)}
                    className="group flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-surface-2"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-xs font-semibold text-foreground">
                      {initials(workspace.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{workspace.name}</span>
                        {workspace.isDefault && (
                          <Badge variant="outline" className="shrink-0">
                            Par défaut
                          </Badge>
                        )}
                        {workspace.myRole === 'owner' && (
                          <Badge variant="info" className="shrink-0">
                            <ShieldCheck className="h-3 w-3" />
                            Propriétaire
                          </Badge>
                        )}
                      </span>
                      <span className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="truncate font-mono">/{workspace.slug}</span>
                        <span className="flex shrink-0 items-center gap-1">
                          <Users className="h-3 w-3" />
                          {workspace.memberCount} membre{workspace.memberCount > 1 ? 's' : ''}
                        </span>
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>

      <CreateWorkspaceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          setCreateOpen(false);
          void mutate();
          void mutateProfile();
        }}
      />
    </div>
  );
}

function CreateWorkspaceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
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

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.workspaces.create({ name, slug: slug.trim() || undefined });
      onCreated();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? err.message
          : 'Impossible de créer ce workspace. Le nom ou le slug est peut-être déjà utilisé (ou réservé).',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouveau workspace</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="workspace-name">Nom</Label>
            <Input id="workspace-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="workspace-slug">Slug (optionnel)</Label>
            <Input
              id="workspace-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="dérivé du nom si vide — utilisé dans l'URL"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Création…' : 'Créer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
