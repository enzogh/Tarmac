'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Layers, LogOut, Mail, Plus, Search, ShieldCheck, Trash2, Users } from 'lucide-react';
import { api, getCurrentWorkspaceId, setCurrentWorkspaceId, WorkspaceListItem, WorkspaceMember } from '../../lib/api';
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

function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
  return letters || '?';
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
  const currentWorkspaceSlug = workspaces?.find((w) => w.id === getCurrentWorkspaceId())?.slug ?? null;

  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [managingWorkspace, setManagingWorkspace] = useState<WorkspaceListItem | null>(null);

  const filtered = useMemo(() => {
    const list = workspaces ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((w) => w.name.toLowerCase().includes(q) || w.slug.toLowerCase().includes(q));
  }, [workspaces, query]);

  const enterWorkspace = (workspace: WorkspaceListItem) => {
    setCurrentWorkspaceId(workspace.id);
    router.push(`/${workspace.slug}/dashboard`);
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
      <header className="border-b border-white/[0.06] bg-gradient-to-b from-violet-600/[0.07] to-transparent">
        <div className="mx-auto max-w-6xl px-6 pb-8 pt-10 sm:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-3 flex items-center gap-2 text-xs font-medium text-violet-400">
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
              {currentWorkspaceSlug && (
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/${currentWorkspaceSlug}/dashboard`}>Retour au tableau de bord</Link>
                </Button>
              )}
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
              const canManage = isSuperuser || workspace.myRole === 'owner';
              return (
                <Card key={workspace.id} className="flex flex-col transition-colors hover:border-white/[0.14]">
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
                    {canManage && (
                      <Button variant="outline" className="gap-2" onClick={() => setManagingWorkspace(workspace)}>
                        <Users className="h-4 w-4" />
                        Membres
                      </Button>
                    )}
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

      <ManageMembersDialog
        workspace={managingWorkspace}
        onOpenChange={(open) => {
          if (!open) setManagingWorkspace(null);
        }}
        onMembershipChanged={() => void mutate()}
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

function ManageMembersDialog({
  workspace,
  onOpenChange,
  onMembershipChanged,
}: {
  workspace: WorkspaceListItem | null;
  onOpenChange: (open: boolean) => void;
  onMembershipChanged: () => void;
}) {
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<WorkspaceMember | null>(null);

  const refreshMembers = async (workspaceId: string) => {
    try {
      const data = await api.workspaces.listMembers(workspaceId);
      setMembers(data);
    } catch {
      setMembersError("Impossible de charger les membres de ce workspace.");
    }
  };

  useEffect(() => {
    setMembers(null);
    setMembersError(null);
    setInviteEmail('');
    setInviteError(null);
    if (workspace) void refreshMembers(workspace.id);
  }, [workspace]);

  const submitInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!workspace) return;
    setInviteLoading(true);
    setInviteError(null);
    try {
      await api.workspaces.invite(workspace.id, inviteEmail.trim());
      setInviteEmail('');
      await refreshMembers(workspace.id);
      onMembershipChanged();
    } catch {
      setInviteError(
        "Aucun compte trouvé pour cet email. Cette personne doit d'abord se connecter une fois via SSO, puis réessaie.",
      );
    } finally {
      setInviteLoading(false);
    }
  };

  const removeMember = async (member: WorkspaceMember) => {
    if (!workspace) return;
    try {
      await api.workspaces.removeMember(workspace.id, member.userId);
      setMemberToRemove(null);
      await refreshMembers(workspace.id);
      onMembershipChanged();
    } catch {
      setMembersError("Impossible de retirer ce membre.");
    }
  };

  return (
    <>
      <Dialog open={!!workspace} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Membres de « {workspace?.name} »</DialogTitle>
          </DialogHeader>

          <form onSubmit={submitInvite} className="space-y-2">
            <Label htmlFor="invite-email">Inviter par email</Label>
            <div className="flex gap-2">
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="personne@exemple.com"
                required
              />
              <Button type="submit" disabled={inviteLoading} className="shrink-0 gap-2">
                <Mail className="h-4 w-4" />
                {inviteLoading ? 'Envoi…' : 'Inviter'}
              </Button>
            </div>
            {inviteError && (
              <Alert variant="destructive" className="mt-2">
                <AlertDescription>{inviteError}</AlertDescription>
              </Alert>
            )}
          </form>

          <div className="mt-5 space-y-2">
            {membersError && (
              <Alert variant="destructive">
                <AlertDescription>{membersError}</AlertDescription>
              </Alert>
            )}
            {members === null && !membersError && <p className="text-sm text-muted-foreground">Chargement…</p>}
            {members?.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">{member.user.name || member.user.email}</p>
                  <p className="truncate text-xs text-muted-foreground">{member.user.email}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {member.role === 'owner' && (
                    <Badge variant="info" className="gap-1">
                      <ShieldCheck className="h-3 w-3" />
                      Propriétaire
                    </Badge>
                  )}
                  <Badge variant="outline">{member.source === 'sso' ? 'SSO' : 'Manuel'}</Badge>
                  <Button variant="ghost" size="icon" onClick={() => setMemberToRemove(member)} title="Retirer">
                    <Trash2 className="h-4 w-4 text-rose-400" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!memberToRemove}
        onOpenChange={(open) => {
          if (!open) setMemberToRemove(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Retirer ce membre ?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {memberToRemove?.user.email} perdra l&apos;accès à ce workspace immédiatement.
          </p>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setMemberToRemove(null)}>
              Annuler
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => memberToRemove && void removeMember(memberToRemove)}
            >
              Retirer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
