'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Building2, LogOut, Mail, Plus, ShieldCheck, Trash2, Users } from 'lucide-react';
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

export default function WorkspacesHomePage() {
  const router = useRouter();
  const { data: profile } = usePolling('profile', api.profile.get, { intervalMs: 60000 });
  const { data: workspaces, isLoading, mutate } = usePolling('workspaces', api.workspaces.list, { intervalMs: 15000 });

  const isSuperuser = profile?.isSuperuser ?? false;
  const hasCurrentWorkspace = !!getCurrentWorkspaceId();

  const [createOpen, setCreateOpen] = useState(false);
  const [managingWorkspace, setManagingWorkspace] = useState<WorkspaceListItem | null>(null);

  const enterWorkspace = (workspace: WorkspaceListItem) => {
    setCurrentWorkspaceId(workspace.id);
    router.push('/dashboard');
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
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-zinc-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 shadow-glow">
              <Building2 className="h-4 w-4 text-white" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-foreground">Mes workspaces</h1>
              <p className="text-[11px] text-muted-foreground">Choisis ou crée un workspace</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasCurrentWorkspace && (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard">Retour au tableau de bord</Link>
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => void handleLogout()} className="gap-2">
              <LogOut className="h-4 w-4" />
              Déconnexion
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {workspaces?.length ?? 0} workspace{(workspaces?.length ?? 0) > 1 ? 's' : ''} accessible
            {(workspaces?.length ?? 0) > 1 ? 's' : ''}
          </p>
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
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
              <Building2 className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Aucun workspace accessible. Contacte un administrateur pour qu&apos;il t&apos;y ajoute.
              </p>
            </CardContent>
          </Card>
        )}

        {!isLoading && workspaces && workspaces.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 animate-fade-in">
            {workspaces.map((workspace) => {
              const canManage = isSuperuser || workspace.myRole === 'owner';
              return (
                <Card key={workspace.id} className="flex flex-col">
                  <CardHeader>
                    <div className="flex items-center justify-between gap-2">
                      <CardTitle className="truncate">{workspace.name}</CardTitle>
                      {workspace.isDefault && <Badge variant="outline">Par défaut</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">{workspace.slug}</p>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-3">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Users className="h-3.5 w-3.5" />
                      {workspace.memberCount} membre{workspace.memberCount > 1 ? 's' : ''}
                    </div>
                    {workspace.myRole === 'owner' && (
                      <Badge variant="info" className="w-fit gap-1">
                        <ShieldCheck className="h-3 w-3" />
                        Propriétaire
                      </Badge>
                    )}
                  </CardContent>
                  <CardFooter className="gap-2">
                    <Button variant="secondary" className="flex-1" onClick={() => enterWorkspace(workspace)}>
                      Entrer
                    </Button>
                    {canManage && (
                      <Button variant="outline" size="icon" onClick={() => setManagingWorkspace(workspace)} title="Gérer les membres">
                        <Users className="h-4 w-4" />
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
      setError('Impossible de créer ce workspace. Le nom ou le slug est peut-être déjà utilisé.');
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
              placeholder="dérivé du nom si vide"
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
