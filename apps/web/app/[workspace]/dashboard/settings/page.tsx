'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AlertTriangle, BellRing, Mail, Save, Send, Settings, ShieldCheck, Trash2, Users } from 'lucide-react';
import { AdminProfile, api, WorkspaceListItem, WorkspaceMember } from '../../../../lib/api';
import { usePolling } from '../../../../lib/hooks/usePolling';
import { PageHeader } from '../../../../components/PageHeader';
import { AnimatedGradientText } from '../../../../components/ui/animated-gradient-text';
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
  const { data: profile, mutate: refreshProfile } = usePolling('profile', api.profile.get, { intervalMs: 60000 });
  const { data: workspaces, mutate: refreshWorkspaces } = usePolling('workspaces', api.workspaces.list, {
    intervalMs: 15000,
  });

  const workspace = workspaces?.find((w) => w.slug === params.workspace || w.id === params.workspace) ?? null;
  const isSuperuser = profile?.isSuperuser ?? false;
  const canManage = isSuperuser || workspace?.myRole === 'owner';

  if (!workspaces || !profile || !workspace) {
    return (
      <div className="space-y-6">
        <PageHeader title="Paramètres" description="Chargement…" />
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="space-y-6">
        <PageHeader title="Paramètres" description={workspace.name} />
        <EmailNotificationsCard profile={profile} onSaved={() => void refreshProfile()} />
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
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Paramètres" description={`Gère « ${workspace.name} »`} />
      <EmailNotificationsCard profile={profile} onSaved={() => void refreshProfile()} />
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

// Personal, not per-workspace: the same address and on/off switch apply to
// every workspace the user belongs to, so it's shown to plain members too.
function EmailNotificationsCard({ profile, onSaved }: { profile: AdminProfile; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const { address, source, internalDomain, mailConfigured } = profile.alertEmail;
  const enabled = profile.alertEmailsEnabled;

  const toggle = async () => {
    setSaving(true);
    setNotice(null);
    try {
      await api.profile.update({ alertEmailsEnabled: !enabled });
      onSaved();
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Impossible de modifier ce réglage.' });
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setNotice(null);
    try {
      const result = await api.profile.sendTestEmail();
      setNotice({ type: 'success', message: `Email de test envoyé à ${result.sentTo}.` });
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : "Impossible d'envoyer l'email de test." });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="h-4 w-4" />
          Alertes par email
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <p className="text-sm text-foreground">Recevoir les alertes de mes workspaces</p>
            <p className="text-xs text-muted-foreground">
              Les alertes qui se déclenchent en même temps sont regroupées dans un seul email.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Recevoir les alertes par email"
            onClick={() => void toggle()}
            disabled={saving}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
              enabled ? 'border-primary bg-primary' : 'border-border bg-surface-3'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                enabled ? 'translate-x-[18px]' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-2xs uppercase tracking-wider text-muted-foreground">Adresse de réception</p>
            <p className="truncate font-mono text-sm text-foreground">{address ?? 'Aucune adresse valide'}</p>
          </div>
          {address &&
            (source === 'internal' ? (
              <Badge variant="success">Interne @{internalDomain}</Badge>
            ) : (
              <Badge variant="warning">Adresse du compte</Badge>
            ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {source === 'internal'
            ? `Adresse @${internalDomain} trouvée sur ton compte à la dernière connexion.`
            : `Aucune adresse @${internalDomain} trouvée sur ton compte : l'adresse d'inscription est utilisée. Elle est relue à chaque connexion.`}
        </p>

        {!mailConfigured && (
          <Alert variant="warning">
            <AlertDescription>
              Le relais SMTP n&apos;est pas configuré sur ce serveur (SMTP_HOST / SMTP_PASSWORD) : aucun email ne part pour l&apos;instant.
            </AlertDescription>
          </Alert>
        )}

        <Button
          type="button"
          variant="outline"
          className="gap-2"
          onClick={() => void sendTest()}
          disabled={testing || !mailConfigured || !address}
        >
          <Send className="h-4 w-4" />
          {testing ? 'Envoi…' : 'Envoyer un email de test'}
        </Button>

        {notice && (
          <Alert variant={notice.type === 'error' ? 'destructive' : 'success'}>
            <AlertDescription>{notice.message}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
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
        <form onSubmit={submit} className="space-y-2">
          <Label htmlFor="workspace-name">Nom</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="workspace-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              className="min-w-0 flex-1"
            />
            <Button type="submit" disabled={saving || name.trim() === workspace.name} className="shrink-0 gap-2">
              <Save className="h-4 w-4" />
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            URL : <span className="font-mono">/{workspace.slug}/dashboard</span> — le slug n&apos;est pas modifiable
            après création.
          </p>
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

        <div className="space-y-1.5">
          {members?.map((member) => {
            const isSelf = member.userId === currentUserId;
            const isOwner = member.role === 'owner';
            // An owner can't remove themselves - see WorkspacesService.removeMember.
            const canRemove = !(isSelf && isOwner);
            return (
              <div
                key={member.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2"
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
                    title="canRemove ? 'Retirer' : 'Un propriétaire ne peut pas se retirer lui-même'"
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
