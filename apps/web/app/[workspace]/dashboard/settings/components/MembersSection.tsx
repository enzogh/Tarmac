'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { LoaderCircle, MoreHorizontal, Search, ShieldCheck, Trash2, UserPlus, UserRoundCog } from 'lucide-react';
import { api, WorkspaceListItem, WorkspaceMember } from '@/lib/api';
import { readOnlyPermissions } from '@/lib/api-key-permissions';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AccessStrip, choiceOf, draftFrom, draftToAccess, MemberAccessDraft, RoleBadge, RoleEditor, roleOf, ROLE_INFO, type RoleChoice } from './roles';

const initials = (member: WorkspaceMember) =>
  (member.user.name || member.user.email)
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
  return <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold', avatarTone(member.userId))}>{initials(member)}</span>;
}

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [query, setQuery] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<WorkspaceMember | null>(null);
  const [removing, setRemoving] = useState<WorkspaceMember | null>(null);

  const refresh = async () => {
    try {
      setMembers(await api.workspaces.listMembers(workspace.id));
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

  const ownerCount = members?.filter((member) => member.role === 'owner').length ?? 0;
  const counts = useMemo(() => {
    const result: Record<RoleChoice, number> = { admin: 0, editor: 0, viewer: 0, custom: 0 };
    members?.forEach((member) => result[roleOf(member.role, member.permissions)]++);
    return result;
  }, [members]);
  const needle = query.trim().toLowerCase();
  const shown = (members ?? []).filter(
    (member) => !needle || member.user.email.toLowerCase().includes(needle) || (member.user.name ?? '').toLowerCase().includes(needle),
  );

  const afterChange = async (message: string) => {
    setNotice({ type: 'success', message });
    await refresh();
    onMembershipChanged();
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
                {ROLE_INFO[choice].label.toLowerCase()}
                {counts[choice] > 1 && choice !== 'custom' ? 's' : ''}
              </span>
            ))}
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
          Ajouter un membre
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
              const choice = roleOf(member.role, member.permissions);
              const lastOwner = member.role === 'owner' && ownerCount <= 1;
              const removeBlocked =
                isSelf && (member.role === 'owner' || isSuperuser)
                  ? 'Vous gérez ce workspace : vous ne pouvez pas vous en retirer vous-même.'
                  : lastOwner
                    ? 'Dernier administrateur du workspace.'
                    : null;
              const editBlocked = isSelf ? 'Vous ne pouvez pas modifier votre propre rôle.' : null;
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
                  <div className="flex w-full items-center gap-3 pl-12 sm:w-auto sm:pl-0">
                    <AccessStrip role={member.role} scopes={member.permissions} className="hidden md:inline-flex" />
                    <RoleBadge choice={choice} />
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
                      <DropdownMenuContent align="end" className="w-64">
                        <DropdownMenuItem
                          disabled={!!removeBlocked}
                          onSelect={() => setRemoving(member)}
                          className="gap-2 text-[hsl(var(--danger))]"
                        >
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

      <p className="flex items-start gap-2 text-2xs leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Les droits s’appliquent immédiatement, côté interface comme côté API. Une personne doit s’être connectée une fois à Tarmac (SSO) avant de
        pouvoir être ajoutée.
      </p>

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        workspace={workspace}
        onInvited={(email, choice) => void afterChange(`${email} a rejoint le workspace en tant que ${ROLE_INFO[choice].label.toLowerCase()}.`)}
      />
      <EditDialog
        member={editing}
        workspace={workspace}
        ownerCount={ownerCount}
        onClose={() => setEditing(null)}
        onSaved={(email, choice) => void afterChange(`Rôle de ${email} mis à jour : ${ROLE_INFO[choice].label.toLowerCase()}.`)}
      />
      <RemoveDialog
        member={removing}
        workspace={workspace}
        onClose={() => setRemoving(null)}
        onRemoved={(email) => void afterChange(`${email} n’a plus accès à ce workspace.`)}
        onError={(message) => setNotice({ type: 'error', message })}
      />
    </div>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  workspace,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace: WorkspaceListItem;
  onInvited: (email: string, choice: RoleChoice) => void;
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
      const member = await api.workspaces.invite(workspace.id, email.trim(), draftToAccess(draft));
      onOpenChange(false);
      onInvited(member.user.email, choiceOf(draft));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible d’ajouter cette personne.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Ajouter un membre</DialogTitle>
            <DialogDescription>Choisissez ce que cette personne pourra voir et modifier dans « {workspace.name} ».</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="invite-email">Adresse email</Label>
            <Input id="invite-email" type="email" required autoFocus value={email} onChange={(event) => setEmail(event.target.value)} placeholder="prenom.nom@exemple.com" />
          </div>
          <div className="space-y-2">
            <Label>Rôle</Label>
            <RoleEditor value={draft} onChange={setDraft} />
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
              {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Ajouter
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
  ownerCount,
  onClose,
  onSaved,
}: {
  member: WorkspaceMember | null;
  workspace: WorkspaceListItem;
  ownerCount: number;
  onClose: () => void;
  onSaved: (email: string, choice: RoleChoice) => void;
}) {
  const [draft, setDraft] = useState<MemberAccessDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(member ? draftFrom(member.role, member.permissions) : null);
    setError(null);
  }, [member]);

  if (!member || !draft) return null;
  const demotingLastOwner = member.role === 'owner' && !draft.admin && ownerCount <= 1;
  const before = draftToAccess(draftFrom(member.role, member.permissions));
  const after = draftToAccess(draft);
  const unchanged = before.role === after.role && before.permissions.join() === after.permissions.join();

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.workspaces.updateMember(workspace.id, member.userId, after);
      onClose();
      onSaved(member.user.email, choiceOf(draft));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de modifier ce rôle.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl space-y-5">
        <DialogHeader>
          <DialogTitle>Rôle de {member.user.name || member.user.email}</DialogTitle>
          <DialogDescription>{member.user.email}</DialogDescription>
        </DialogHeader>
        <RoleEditor value={draft} onChange={setDraft} />
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
