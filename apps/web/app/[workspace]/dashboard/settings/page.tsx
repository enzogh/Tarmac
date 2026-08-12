'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AlertTriangle, Mail, Save, Settings, ShieldCheck, Trash2, Users } from 'lucide-react';
import { api, WorkspaceListItem, WorkspaceMember } from '../../../../lib/api';
import { usePolling } from '../../../../lib/hooks/usePolling';
import { PageHeader } from '../../../../components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { Badge } from '../../../../components/ui/badge';
import { Alert, AlertDescription } from '../../../../components/ui/alert';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../../../components/ui/dialog';

export default function WorkspaceSettingsPage() {
  const params = useParams<{ workspace: string }>();
  const router = useRouter();
  const { data: profile } = usePolling('profile', api.profile.get, { intervalMs: 60000 });
  const { data: workspaces, mutate: refreshWorkspaces } = usePolling('workspaces', api.workspaces.list, {
    intervalMs: 15000,
  });

  const workspace = workspaces?.find((w) => w.slug === params.workspace || w.id === params.workspace) ?? null;
  const isSuperuser = profile?.isSuperuser ?? false;
  const canManage = isSuperuser || workspace?.myRole === 'owner';

  if (!workspaces || !profile || !workspace) {
    return (
      <div className="space-y-6">
        <PageHeader icon={Settings} title="Paramètres" description="Chargement…" />
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="space-y-6">
        <PageHeader icon={Settings} title="Paramètres" description={workspace.name} />
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
            <ShieldCheck className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Tu es membre de « {workspace.name} » mais seul son propriétaire (ou un administrateur de la plateforme)
              peut le renommer ou gérer ses membres.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader icon={Settings} title="Paramètres" description={`Gère « ${workspace.name} »`} />
      <RenameCard workspace={workspace} onSaved={() => void refreshWorkspaces()} />
      <MembersCard
        workspace={workspace}
        currentUserId={profile.id}
        onMembershipChanged={() => void refreshWorkspaces()}
      />
      <DangerZoneCard
        workspace={workspace}
        onDeleted={() => {
          void refreshWorkspaces();
          router.push('/workspaces');
        }}
      />
    </div>
  );
}

function RenameCard({ workspace, onSaved }: { workspace: WorkspaceListItem; onSaved: () => void }) {
  const [name, setName] = useState(workspace.name);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    setName(workspace.name);
  }, [workspace.name]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === workspace.name) return;
    setSaving(true);
    setNotice(null);
    try {
      await api.workspaces.update(workspace.id, { name: name.trim() });
      setNotice({ type: 'success', message: 'Nom mis à jour.' });
      onSaved();
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Impossible de renommer ce workspace.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Général</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <Label htmlFor="workspace-name">Nom</Label>
            <Input id="workspace-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
            <p className="text-xs text-muted-foreground">
              URL : /{workspace.slug}/dashboard — le slug n&apos;est pas modifiable après création.
            </p>
          </div>
          <Button type="submit" disabled={saving || name.trim() === workspace.name} className="gap-2">
            <Save className="h-4 w-4" />
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </form>
        {notice && (
          <Alert variant={notice.type === 'error' ? 'destructive' : 'success'} className="mt-4">
            <AlertDescription>{notice.message}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function MembersCard({
  workspace,
  currentUserId,
  onMembershipChanged,
}: {
  workspace: WorkspaceListItem;
  currentUserId: string;
  onMembershipChanged: () => void;
}) {
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<WorkspaceMember | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const refreshMembers = async () => {
    try {
      const data = await api.workspaces.listMembers(workspace.id);
      setMembers(data);
    } catch {
      setMembersError('Impossible de charger les membres de ce workspace.');
    }
  };

  useEffect(() => {
    setMembers(null);
    setMembersError(null);
    void refreshMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id]);

  const submitInvite = async (event: FormEvent) => {
    event.preventDefault();
    setInviteLoading(true);
    setInviteError(null);
    try {
      await api.workspaces.invite(workspace.id, inviteEmail.trim());
      setInviteEmail('');
      await refreshMembers();
      onMembershipChanged();
    } catch (error) {
      setInviteError(
        error instanceof Error
          ? error.message
          : "Aucun compte trouvé pour cet email. Cette personne doit d'abord se connecter une fois via SSO.",
      );
    } finally {
      setInviteLoading(false);
    }
  };

  const confirmRemove = async (member: WorkspaceMember) => {
    setRemoveError(null);
    try {
      await api.workspaces.removeMember(workspace.id, member.userId);
      setMemberToRemove(null);
      await refreshMembers();
      onMembershipChanged();
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : 'Impossible de retirer ce membre.');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          Membres
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <form onSubmit={submitInvite} className="space-y-2">
          <Label htmlFor="settings-invite-email">Inviter par email</Label>
          <div className="flex gap-2">
            <Input
              id="settings-invite-email"
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
            <Alert variant="destructive">
              <AlertDescription>{inviteError}</AlertDescription>
            </Alert>
          )}
        </form>

        {membersError && (
          <Alert variant="destructive">
            <AlertDescription>{membersError}</AlertDescription>
          </Alert>
        )}
        {removeError && (
          <Alert variant="destructive">
            <AlertDescription>{removeError}</AlertDescription>
          </Alert>
        )}
        {members === null && !membersError && <p className="text-sm text-muted-foreground">Chargement…</p>}

        <div className="space-y-2">
          {members?.map((member) => {
            const isSelf = member.userId === currentUserId;
            const isOwner = member.role === 'owner';
            // An owner can't remove themselves - see WorkspacesService.removeMember.
            const canRemove = !(isSelf && isOwner);
            return (
              <div
                key={member.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">
                    {member.user.name || member.user.email}
                    {isSelf && <span className="ml-1.5 text-xs text-muted-foreground">(toi)</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{member.user.email}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {isOwner && (
                    <Badge variant="info" className="gap-1">
                      <ShieldCheck className="h-3 w-3" />
                      Propriétaire
                    </Badge>
                  )}
                  <Badge variant="outline">{member.source === 'sso' ? 'SSO' : 'Manuel'}</Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={!canRemove}
                    title={canRemove ? 'Retirer' : 'Un propriétaire ne peut pas se retirer lui-même'}
                    onClick={() => setMemberToRemove(member)}
                  >
                    <Trash2 className={canRemove ? 'h-4 w-4 text-rose-400' : 'h-4 w-4 text-muted-foreground'} />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>

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
            <Button type="button" variant="destructive" onClick={() => memberToRemove && void confirmRemove(memberToRemove)}>
              Retirer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function DangerZoneCard({ workspace, onDeleted }: { workspace: WorkspaceListItem; onDeleted: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (workspace.isDefault) {
    return null;
  }

  const confirmDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await api.workspaces.delete(workspace.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de supprimer ce workspace.');
      setDeleting(false);
    }
  };

  return (
    <Card className="border-rose-500/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-rose-300">
          <AlertTriangle className="h-4 w-4" />
          Zone de danger
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Supprime définitivement « {workspace.name} ». Impossible tant qu&apos;il reste des nœuds, pools, partages ou
          autres ressources dedans — retire-les d&apos;abord.
        </p>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button variant="destructive" className="gap-2" onClick={() => setConfirmOpen(true)}>
          <Trash2 className="h-4 w-4" />
          Supprimer ce workspace
        </Button>
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer « {workspace.name} » ?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Cette action est irréversible. Le workspace, ses membres et sa configuration réseau seront supprimés
            définitivement.
          </p>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)} disabled={deleting}>
              Annuler
            </Button>
            <Button type="button" variant="destructive" onClick={() => void confirmDelete()} disabled={deleting}>
              {deleting ? 'Suppression…' : 'Supprimer définitivement'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
