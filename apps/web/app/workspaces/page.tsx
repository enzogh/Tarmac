'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Layers, LogOut, Plus, Search, ShieldCheck, Users } from 'lucide-react';
import { api, setCurrentWorkspaceId, WorkspaceListItem } from '../../lib/api';
import { usePolling } from '../../lib/hooks/usePolling';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../../components/ui/card';
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

// A handful of curated gradient pairs (kept in the app's existing
// violet/indigo family, plus a few complementary hues) so a grid of many
// workspace cards stays visually distinguishable at a glance instead of
// every tile being identically violet. Deterministic per workspace id, not
// random, so a given workspace always gets the same tile between renders.
const TILE_GRADIENTS = [
  'from-violet-600/90 to-indigo-600/90',
  'from-sky-600/90 to-cyan-600/90',
  'from-emerald-600/90 to-teal-600/90',
  'from-amber-600/90 to-orange-600/90',
  'from-rose-600/90 to-pink-600/90',
  'from-fuchsia-600/90 to-purple-600/90',
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

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

function WorkspaceTile({ id, name }: { id: string; name: string }) {
  const gradient = TILE_GRADIENTS[hashString(id) % TILE_GRADIENTS.length];
  return (
    <span
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-sm font-semibold text-white shadow-glow ${gradient}`}
    >
      {initials(name)}
    </span>
  );
}

export default function WorkspacesHomePage() {
  const router = useRouter();
  const { data: profile } = usePolling('profile', api.profile.get, { intervalMs: 60000 });
  const { data: workspaces, isLoading, mutate } = usePolling('workspaces', api.workspaces.list, { intervalMs: 15000 });

  const isSuperuser = profile?.isSuperuser ?? false;

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

  return (
    <div className="min-h-screen bg-zinc-950">
      <header className="border-b border-border bg-gradient-to-b from-violet-600/[0.07] to-transparent">
        <div className="mx-auto max-w-6xl px-6 pb-8 pt-10 sm:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Layers className="h-3.5 w-3.5" />
                Tarmac
              </div>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">Mes workspaces</h1>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                Choisis un workspace pour ouvrir son tableau de bord, ou crée-en un nouveau pour regrouper de nouvelles
                nodes.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => void handleLogout()} className="gap-2">
                <LogOut className="h-4 w-4" />
                Déconnexion
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8 sm:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-1 items-center gap-3">
            <p className="shrink-0 text-sm text-muted-foreground">
              {workspaces?.length ?? 0} workspace{(workspaces?.length ?? 0) > 1 ? 's' : ''}
            </p>
            {(workspaces?.length ?? 0) > 5 && (
              <div className="relative w-full max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Rechercher un workspace…"
                  className="h-8 pl-8 text-xs"
                />
              </div>
            )}
          </div>
          {isSuperuser && (
            <Button onClick={() => setCreateOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Nouveau workspace
            </Button>
          )}
        </div>

        {isLoading && <CardListSkeleton cards={3} />}

        {!isLoading && workspaces && workspaces.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
              <Layers className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Aucun workspace accessible. Contacte un administrateur pour qu&apos;il t&apos;y ajoute.
              </p>
            </CardContent>
          </Card>
        )}

        {!isLoading && workspaces && workspaces.length > 0 && filtered.length === 0 && (
          <p className="py-16 text-center text-sm text-muted-foreground">Aucun workspace ne correspond à « {query} ».</p>
        )}

        {!isLoading && filtered.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 animate-fade-in">
            {filtered.map((workspace) => {
              return (
                <Card key={workspace.id} className="flex flex-col transition-colors hover:border-border">
                  <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
                    <div className="flex min-w-0 items-center gap-3">
                      <WorkspaceTile id={workspace.id} name={workspace.name} />
                      <div className="min-w-0">
                        <CardTitle className="truncate text-base">{workspace.name}</CardTitle>
                        <p className="truncate text-xs text-muted-foreground">{workspace.slug}</p>
                      </div>
                    </div>
                    {workspace.isDefault && (
                      <Badge variant="outline" className="shrink-0">
                        Par défaut
                      </Badge>
                    )}
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-2 pt-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Users className="h-3.5 w-3.5" />
                        {workspace.memberCount} membre{workspace.memberCount > 1 ? 's' : ''}
                      </span>
                      {workspace.myRole === 'owner' && (
                        <Badge variant="info" className="gap-1">
                          <ShieldCheck className="h-3 w-3" />
                          Propriétaire
                        </Badge>
                      )}
                    </div>
                  </CardContent>
                  <CardFooter className="gap-2 pt-0">
                    <Button className="flex-1 gap-2" onClick={() => enterWorkspace(workspace)}>
                      Entrer
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      <CreateWorkspaceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          setCreateOpen(false);
          void mutate();
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
    } catch {
      setError('Impossible de créer ce workspace. Le nom ou le slug est peut-être déjà utilisé (ou réservé).');
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
