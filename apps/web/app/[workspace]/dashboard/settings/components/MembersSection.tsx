'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Clock, Crown, LoaderCircle, Mail, MailCheck, MoreHorizontal, RotateCw, Search, ShieldCheck, Trash2, UserPlus, UserRoundCog, X } from 'lucide-react';
import { api, WorkspaceCustomRole, WorkspaceInvitation, WorkspaceListItem, WorkspaceMember } from '@/lib/api';
import { readOnlyPermissions } from '@/lib/api-key-permissions';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AccessStrip, choiceOf, draftFrom, draftToAccess, MemberAccessDraft, RoleBadge, RoleEditor, roleOf, ROLE_INFO, type RoleChoice } from './roles';

const initialsOf = (label: string) =>
  label
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

const AVATAR_TONES = ['bg-[hsl(var(--chart-1))]/20 text-[hsl(var(--chart-1))]', 'bg-[hsl(var(--chart-2))]/20 text-[hsl(var(--chart-2))]', 'bg-[hsl(var(--chart-3))]/20 text-[hsl(var(--chart-3))]', 'bg-[hsl(var(--chart-4))]/20 text-[hsl(var(--chart-4))]', 'bg-[hsl(var(--chart-5))]/20 text-[hsl(var(--chart-5))]'];
const avatarTone = (id: string) => AVATAR_TONES[[...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % AVATAR_TONES.length];

function Avatar({ member }: { member: WorkspaceMember }) {
  if (member.user.avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={member.user.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />;
  }
  return (
    <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold', avatarTone(member.userId))}>
      {initialsOf(member.user.name || member.user.email)}
    </span>
  );
}

const dateFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
const roleLabel = (choice: RoleChoice, name?: string | null) => (choice === 'role' && name ? `« ${name} »` : ROLE_INFO[choice].label.toLowerCase());

export function MembersSection({
  workspace,
  currentUserId,
  isSuperuser,
  onMembershipChanged,
}: {
  workspace: WorkspaceListItem;
  currentUserId: string;
  isSuperuser: boolean;
  onMembershipChanged: () => void;
}) {
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [customRoles, setCustomRoles] = useState<WorkspaceCustomRole[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [query, setQuery] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<WorkspaceMember | null>(null);
  const [removing, setRemoving] = useState<WorkspaceMember | null>(null);
  const [transferring, setTransferring] = useState<WorkspaceMember | null>(null);
  const [busyInvite, setBusyInvite] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const [nextMembers, nextInvitations, nextRoles] = await Promise.all([
        api.workspaces.listMembers(workspace.id),
        api.workspaces.invitations(workspace.id),
        api.workspaces.roles(workspace.id),
      ]);
      setMembers(nextMembers);
      setInvitations(nextInvitations);
      setCustomRoles(nextRoles);
      setLoadError(null);
    } catch {
      setLoadError('Impossible de charger les membres de ce workspace.');
    }
  };

  useEffect(() => {
    setMembers(null);
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id]);

  // Who may hand the workspace over: its owner, a platform admin, or any
  // administrator of a workspace created before ownership existed.
  const canTransfer = isSuperuser || workspace.isOwner || (!workspace.createdById && workspace.myRole === 'owner');
  const ownerCount = members?.filter((member) => member.role === 'owner').length ?? 0;
  const counts = useMemo(() => {
    const result: Record<RoleChoice, number> = { admin: 0, editor: 0, viewer: 0, custom: 0, role: 0 };
    members?.forEach((member) => result[roleOf(member.role, member.permissions, member.customRoleId)]++);
    return result;
  }, [members]);
  const needle = query.trim().toLowerCase();
  const shown = (members ?? []).filter(
    (member) => !needle || member.user.email.toLowerCase().includes(needle) || (member.user.name ?? '').toLowerCase().includes(needle),
  );

  const afterChange = async (message: string, type: 'success' | 'error' = 'success') => {
    setNotice({ type, message });
    await refresh();
    onMembershipChanged();
  };

  const resend = async (invitation: WorkspaceInvitation) => {
    setBusyInvite(invitation.id);
    try {
      await api.workspaces.resendInvitation(workspace.id, invitation.id);
      await afterChange(`Invitation renvoyée à ${invitation.email}. Elle est de nouveau valable 30 jours.`);
    } catch (err) {
      setNotice({ type: 'error', message: err instanceof Error ? err.message : 'Impossible de renvoyer cette invitation.' });
    } finally {
      setBusyInvite(null);
    }
  };

  const revoke = async (invitation: WorkspaceInvitation) => {
    setBusyInvite(invitation.id);
    try {
      await api.workspaces.revokeInvitation(workspace.id, invitation.id);
      await afterChange(`Invitation de ${invitation.email} annulée.`);
    } catch (err) {
      setNotice({ type: 'error', message: err instanceof Error ? err.message : 'Impossible d’annuler cette invitation.' });
    } finally {
      setBusyInvite(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {(Object.keys(counts) as RoleChoice[])
            .filter((choice) => counts[choice] > 0)
            .map((choice) => (
              <span key={choice} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 py-1 text-2xs text-muted-foreground">
                <span className="font-semibold tabular-nums text-foreground">{counts[choice]}</span>
                {choice === 'role' ? `rôle${counts[choice] > 1 ? 's' : ''} du workspace` : `${ROLE_INFO[choice].label.toLowerCase()}${counts[choice] > 1 && choice !== 'custom' ? 's' : ''}`}
              </span>
            ))}
          {invitations.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-1 text-2xs text-muted-foreground">
              <span className="font-semibold tabular-nums text-foreground">{invitations.length}</span>
              en attente
            </span>
          )}
        </div>
        <span className="flex-1" />
        {(members?.length ?? 0) > 6 && (
          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un membre…" className="h-8 pl-8" />
          </div>
        )}
        <Button onClick={() => setInviteOpen(true)} className="gap-1.5">
          <UserPlus className="h-4 w-4" />
          Inviter
        </Button>
      </div>

      {notice && (
        <Alert variant={notice.type === 'error' ? 'destructive' : 'success'}>
          <AlertDescription>{notice.message}</AlertDescription>
        </Alert>
      )}
      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      <Card className="overflow-hidden">
        {members === null && !loadError ? (
          <div className="flex items-center gap-2 px-4 py-10 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            Chargement des membres…
          </div>
        ) : shown.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">Aucun membre ne correspond.</p>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((member) => {
              const isSelf = member.userId === currentUserId;
              const choice = roleOf(member.role, member.permissions, member.customRoleId);
              const lastOwner = member.role === 'owner' && ownerCount <= 1;
              const removeBlocked = member.isOwner
                ? 'Propriétaire du workspace : transférez d’abord la propriété.'
                : isSelf && (member.role === 'owner' || isSuperuser)
                  ? 'Vous gérez ce workspace : vous ne pouvez pas vous en retirer vous-même.'
                  : lastOwner
                    ? 'Dernier administrateur du workspace.'
                    : null;
              const editBlocked = isSelf
                ? 'Vous ne pouvez pas modifier votre propre rôle.'
                : member.isOwner
                  ? 'Le propriétaire reste administrateur. Transférez la propriété pour changer son rôle.'
                  : null;
              const transferBlocked = !canTransfer ? 'Réservé au propriétaire du workspace.' : member.isOwner ? 'Déjà propriétaire.' : null;
              return (
                <li key={member.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:flex-nowrap">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar member={member} />
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
                        <span className="truncate">{member.user.name || member.user.email}</span>
                        {isSelf && <span className="shrink-0 rounded bg-surface-3 px-1.5 py-px text-2xs font-normal text-muted-foreground">vous</span>}
                        {member.source === 'sso' && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="shrink-0 rounded border border-border px-1.5 py-px text-2xs font-normal text-muted-foreground">SSO</span>
                            </TooltipTrigger>
                            <TooltipContent>Ajouté automatiquement par son groupe SSO</TooltipContent>
                          </Tooltip>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{member.user.email}</p>
                    </div>
                  </div>
                  <div className="flex w-full flex-wrap items-center gap-2 pl-12 sm:w-auto sm:flex-nowrap sm:gap-3 sm:pl-0">
                    {/* Administrators reach everything: the strip would only repeat it. */}
                    {member.role !== 'owner' && <AccessStrip role={member.role} scopes={member.permissions} className="hidden md:inline-flex" />}
                    {member.isOwner && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex shrink-0 items-center gap-1 rounded border border-[hsl(var(--warn))]/30 bg-[hsl(var(--warn))]/10 px-1.5 py-px text-2xs font-medium text-[hsl(var(--warn))]">
                            <Crown className="h-3 w-3" />
                            Propriétaire
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>Ce workspace compte dans sa limite de création, et le rapport hebdomadaire lui est adressé.</TooltipContent>
                      </Tooltip>
                    )}
                    <RoleBadge choice={choice} name={member.customRole?.name} />
                    <span className="flex-1 sm:hidden" />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button variant="secondary" size="sm" disabled={!!editBlocked} onClick={() => setEditing(member)} className="h-8 gap-1.5">
                            <UserRoundCog className="h-3.5 w-3.5" />
                            Modifier
                          </Button>
                        </span>
                      </TooltipTrigger>
                      {editBlocked && <TooltipContent>{editBlocked}</TooltipContent>}
                    </Tooltip>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Plus d’actions pour ${member.user.email}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-72">
                        <DropdownMenuItem disabled={!!transferBlocked} onSelect={() => setTransferring(member)} className="gap-2">
                          <Crown className="h-3.5 w-3.5" />
                          <span className="min-w-0">
                            Transférer la propriété
                            {transferBlocked && <span className="block text-2xs text-muted-foreground">{transferBlocked}</span>}
                          </span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled={!!removeBlocked} onSelect={() => setRemoving(member)} className="gap-2 text-[hsl(var(--danger))]">
                          <Trash2 className="h-3.5 w-3.5" />
                          <span className="min-w-0">
                            Retirer du workspace
                            {removeBlocked && <span className="block text-2xs text-muted-foreground">{removeBlocked}</span>}
                          </span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {invitations.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Invitations en attente</p>
            <span className="hidden text-2xs text-muted-foreground sm:inline">· acceptées automatiquement à la première connexion</span>
          </div>
          <ul className="divide-y divide-border">
            {invitations.map((invitation) => {
              const choice = roleOf(invitation.role, invitation.permissions, invitation.customRoleId);
              const busy = busyInvite === invitation.id;
              return (
                <li key={invitation.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:flex-nowrap">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground">
                      <Mail className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{invitation.email}</p>
                      <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                        {invitation.expired ? (
                          <span className="text-[hsl(var(--warn))]">Expirée le {dateFormat.format(new Date(invitation.expiresAt))}</span>
                        ) : (
                          <>
                            <Clock className="h-3 w-3 shrink-0" />
                            Valable jusqu’au {dateFormat.format(new Date(invitation.expiresAt))}
                          </>
                        )}
                        {invitation.invitedBy && <span className="truncate"> · par {invitation.invitedBy}</span>}
                        {!invitation.lastSentAt && <span className="text-[hsl(var(--warn))]"> · email non envoyé</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex w-full flex-wrap items-center gap-2 pl-12 sm:w-auto sm:flex-nowrap sm:pl-0">
                    <RoleBadge choice={choice} name={invitation.customRole?.name} />
                    <span className="flex-1 sm:hidden" />
                    <Button variant="secondary" size="sm" className="h-8 gap-1.5" disabled={busy} onClick={() => void resend(invitation)}>
                      {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
                      Renvoyer
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label={`Annuler l’invitation de ${invitation.email}`} disabled={busy} onClick={() => void revoke(invitation)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <p className="flex items-start gap-2 text-2xs leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Les droits s’appliquent immédiatement, côté interface comme côté API. Une personne qui ne s’est encore jamais connectée reçoit une invitation
        par email : elle rejoint le workspace à sa première connexion (elle doit faire partie du groupe d’accès Tarmac).
      </p>

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        workspace={workspace}
        customRoles={customRoles}
        onDone={(message, type) => void afterChange(message, type)}
      />
      <EditDialog
        member={editing}
        workspace={workspace}
        customRoles={customRoles}
        ownerCount={ownerCount}
        onClose={() => setEditing(null)}
        onSaved={(email, label) => void afterChange(`Rôle de ${email} mis à jour : ${label}.`)}
      />
      <RemoveDialog
        member={removing}
        workspace={workspace}
        onClose={() => setRemoving(null)}
        onRemoved={(email) => void afterChange(`${email} n’a plus accès à ce workspace.`)}
        onError={(message) => setNotice({ type: 'error', message })}
      />
      <TransferDialog
        member={transferring}
        workspace={workspace}
        isSuperuser={isSuperuser}
        onClose={() => setTransferring(null)}
        onTransferred={(email) => void afterChange(`${email} est maintenant propriétaire de « ${workspace.name} ». Un email l’en a informé.`)}
      />
    </div>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  workspace,
  customRoles,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: WorkspaceListItem;
  customRoles: WorkspaceCustomRole[];
  onDone: (message: string, type?: 'success' | 'error') => void;
}) {
  const [email, setEmail] = useState('');
  // A newcomer starts read-only: widening access is a deliberate step.
  const [draft, setDraft] = useState<MemberAccessDraft>({ admin: false, custom: false, permissions: readOnlyPermissions() });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setEmail('');
    setDraft({ admin: false, custom: false, permissions: readOnlyPermissions() });
    setError(null);
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await api.workspaces.invite(workspace.id, email.trim(), draftToAccess(draft));
      const label = roleLabel(choiceOf(draft), customRoles.find((role) => role.id === draft.customRoleId)?.name);
      onOpenChange(false);
      if (result.status === 'added') {
        onDone(
          `${result.membership.user.email} a rejoint le workspace en tant que ${label}${result.emailed ? ' et a été prévenu par email' : ''}.`,
        );
      } else {
        onDone(
          result.invitation.emailed
            ? `Invitation envoyée à ${result.invitation.email} (${label}). L’accès lui sera donné à sa première connexion.`
            : `Invitation enregistrée pour ${result.invitation.email}, mais l’email n’a pas pu partir. Prévenez cette personne directement : l’accès lui sera donné à sa première connexion.`,
          result.invitation.emailed ? 'success' : 'error',
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible d’inviter cette personne.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Inviter dans « {workspace.name} »</DialogTitle>
            <DialogDescription>
              Un compte existant est ajouté tout de suite. Sinon, la personne reçoit une invitation par email et rejoint le workspace à sa première
              connexion.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="invite-email">Adresse email</Label>
            <Input id="invite-email" type="email" required autoFocus value={email} onChange={(event) => setEmail(event.target.value)} placeholder="prenom.nom@exemple.com" />
            <p className="text-2xs text-muted-foreground">Celle de son compte d’entreprise (SSO), sans quoi l’invitation ne pourra pas lui être rattachée.</p>
          </div>
          <div className="space-y-2">
            <Label>Rôle</Label>
            <RoleEditor value={draft} onChange={setDraft} customRoles={customRoles} />
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={saving || !email.trim()} className="gap-1.5">
              {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <MailCheck className="h-4 w-4" />}
              Inviter
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({
  member,
  workspace,
  customRoles,
  ownerCount,
  onClose,
  onSaved,
}: {
  member: WorkspaceMember | null;
  workspace: WorkspaceListItem;
  customRoles: WorkspaceCustomRole[];
  ownerCount: number;
  onClose: () => void;
  onSaved: (email: string, label: string) => void;
}) {
  const [draft, setDraft] = useState<MemberAccessDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(member ? draftFrom(member.role, member.permissions, member.customRoleId) : null);
    setError(null);
  }, [member]);

  if (!member || !draft) return null;
  const demotingLastOwner = member.role === 'owner' && !draft.admin && ownerCount <= 1;
  const before = draftToAccess(draftFrom(member.role, member.permissions, member.customRoleId));
  const after = draftToAccess(draft);
  const unchanged = before.role === after.role && before.permissions.join() === after.permissions.join() && before.customRoleId === after.customRoleId;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.workspaces.updateMember(workspace.id, member.userId, after);
      onClose();
      onSaved(member.user.email, roleLabel(choiceOf(draft), customRoles.find((role) => role.id === draft.customRoleId)?.name));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de modifier ce rôle.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl space-y-5 overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Rôle de {member.user.name || member.user.email}</DialogTitle>
          <DialogDescription>{member.user.email}</DialogDescription>
        </DialogHeader>
        <RoleEditor value={draft} onChange={setDraft} customRoles={customRoles} />
        {demotingLastOwner && (
          <Alert variant="warning">
            <AlertDescription>C’est le dernier administrateur : nommez-en un autre avant de lui retirer ce rôle.</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving || unchanged || demotingLastOwner} className="gap-1.5">
            {saving && <LoaderCircle className="h-4 w-4 animate-spin" />}
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoveDialog({
  member,
  workspace,
  onClose,
  onRemoved,
  onError,
}: {
  member: WorkspaceMember | null;
  workspace: WorkspaceListItem;
  onClose: () => void;
  onRemoved: (email: string) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    if (!member) return;
    setBusy(true);
    try {
      await api.workspaces.removeMember(workspace.id, member.userId);
      onClose();
      onRemoved(member.user.email);
    } catch (err) {
      onClose();
      onError(err instanceof Error ? err.message : 'Impossible de retirer ce membre.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!member} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Retirer ce membre ?</DialogTitle>
          <DialogDescription>
            {member?.user.email} perdra immédiatement l’accès à « {workspace.name} ».
            {member?.source === 'sso' && ' Son groupe SSO pourra lui redonner accès à sa prochaine connexion.'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button type="button" variant="destructive" onClick={() => void confirm()} disabled={busy}>
            {busy ? 'Retrait…' : 'Retirer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({
  member,
  workspace,
  isSuperuser,
  onClose,
  onTransferred,
}: {
  member: WorkspaceMember | null;
  workspace: WorkspaceListItem;
  isSuperuser: boolean;
  onClose: () => void;
  onTransferred: (email: string) => void;
}) {
  const [keepAdmin, setKeepAdmin] = useState(true);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setKeepAdmin(true);
    setTyped('');
    setError(null);
  }, [member]);

  if (!member) return null;
  // The one handing over is the current owner (or, for a platform admin
  // acting on someone else's workspace, nobody in particular).
  const handingOwnOwnership = workspace.isOwner;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.workspaces.transfer(workspace.id, member.userId, keepAdmin);
      onClose();
      onTransferred(member.user.email);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de transférer la propriété.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="h-4 w-4 text-[hsl(var(--warn))]" />
            Transférer la propriété
          </DialogTitle>
          <DialogDescription>
            {member.user.name || member.user.email} deviendra propriétaire de « {workspace.name} ».
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <ul className="space-y-2 rounded-lg border border-border bg-surface-2 p-3 text-xs text-muted-foreground">
            <li className="flex gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              Obtient le rôle administrateur et reçoit désormais le rapport hebdomadaire.
            </li>
            <li className="flex gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              Le workspace compte dans sa limite de création{handingOwnOwnership ? ' et libère une place dans la vôtre' : ''}.
            </li>
            <li className="flex gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              Un email l’en informe.
            </li>
          </ul>

          {handingOwnOwnership && (
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm hover:bg-surface-2">
              <input type="checkbox" checked={keepAdmin} onChange={(event) => setKeepAdmin(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" />
              <span>
                <span className="block font-medium text-foreground">Rester administrateur</span>
                <span className="block text-xs text-muted-foreground">Sinon, vous gardez l’accès en tant qu’éditeur, sans gérer le workspace.</span>
              </span>
            </label>
          )}

          {!isSuperuser && (
            <p className="text-2xs text-muted-foreground">Si sa limite de création est déjà atteinte, un administrateur de la plateforme devra l’augmenter d’abord.</p>
          )}

          <div className="space-y-2">
            <Label htmlFor="confirm-transfer" className="text-xs font-normal text-muted-foreground">
              Tapez <span className="font-mono font-medium text-foreground">{workspace.name}</span> pour confirmer
            </Label>
            <Input id="confirm-transfer" value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button type="button" onClick={() => void confirm()} disabled={busy || typed.trim() !== workspace.name} className="gap-1.5">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Crown className="h-4 w-4" />}
            Transférer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
