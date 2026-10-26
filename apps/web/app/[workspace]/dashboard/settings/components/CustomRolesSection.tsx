'use client';

import { FormEvent, useEffect, useState } from 'react';
import { LoaderCircle, Pencil, Plus, Tag, Trash2, Users } from 'lucide-react';
import { api, WorkspaceCustomRole, WorkspaceListItem } from '@/lib/api';
import { PermissionMap, permissionsToScopes, readOnlyPermissions, scopesToPermissions } from '@/lib/api-key-permissions';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PermissionEditor } from '../../api-keys/components/PermissionEditor';
import { AccessStrip } from './roles';

// Named permission sets ("Support N1", "Opérateur stockage"...) that
// administrators assign from the member dialogs. Editing one updates every
// member who follows it.
export function CustomRolesSection({ workspace }: { workspace: WorkspaceListItem }) {
  const [roles, setRoles] = useState<WorkspaceCustomRole[] | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [editing, setEditing] = useState<WorkspaceCustomRole | 'new' | null>(null);
  const [deleting, setDeleting] = useState<WorkspaceCustomRole | null>(null);

  const refresh = async () => {
    try {
      setRoles(await api.workspaces.roles(workspace.id));
    } catch {
      setNotice({ type: 'error', message: 'Impossible de charger les rôles de ce workspace.' });
    }
  };

  useEffect(() => {
    setRoles(null);
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id]);

  const done = async (message: string) => {
    setNotice({ type: 'success', message });
    await refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-xs text-muted-foreground">
          En plus d’Administrateur, Éditeur et Lecteur, créez des rôles adaptés à votre équipe. Ils apparaissent ensuite au moment d’inviter ou de
          modifier un membre.
        </p>
        <Button onClick={() => setEditing('new')} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Nouveau rôle
        </Button>
      </div>

      {notice && (
        <Alert variant={notice.type === 'error' ? 'destructive' : 'success'}>
          <AlertDescription>{notice.message}</AlertDescription>
        </Alert>
      )}

      {roles === null ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            Chargement des rôles…
          </CardContent>
        </Card>
      ) : roles.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 text-muted-foreground">
              <Tag className="h-5 w-5" />
            </span>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">Aucun rôle personnalisé</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Par exemple « Support » : lecture partout, modification des alertes. Chaque membre qui suit ce rôle en reçoit les droits.
              </p>
            </div>
            <Button variant="outline" onClick={() => setEditing('new')} className="mt-1 gap-1.5">
              <Plus className="h-4 w-4" />
              Créer un rôle
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {roles.map((role) => (
              <li key={role.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:flex-nowrap">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--chart-5))]/10 text-[hsl(var(--chart-5))]">
                    <Tag className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{role.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{role.description || 'Sans description'}</p>
                  </div>
                </div>
                <div className="flex w-full items-center gap-3 pl-12 sm:w-auto sm:pl-0">
                  <AccessStrip role="member" scopes={role.permissions} />
                  <span className="inline-flex items-center gap-1 whitespace-nowrap text-2xs text-muted-foreground">
                    <Users className="h-3 w-3" />
                    {role.memberCount} membre{role.memberCount > 1 ? 's' : ''}
                  </span>
                  <span className="flex-1 sm:hidden" />
                  <Button variant="secondary" size="sm" className="h-8 gap-1.5" onClick={() => setEditing(role)}>
                    <Pencil className="h-3.5 w-3.5" />
                    Modifier
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-[hsl(var(--danger))]" aria-label={`Supprimer le rôle ${role.name}`} onClick={() => setDeleting(role)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <RoleDialog
        workspace={workspace}
        role={editing}
        onClose={() => setEditing(null)}
        onSaved={(message) => {
          setEditing(null);
          void done(message);
        }}
      />
      <DeleteRoleDialog
        workspace={workspace}
        role={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={(message) => {
          setDeleting(null);
          void done(message);
        }}
      />
    </div>
  );
}

function RoleDialog({
  workspace,
  role,
  onClose,
  onSaved,
}: {
  workspace: WorkspaceListItem;
  role: WorkspaceCustomRole | 'new' | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<PermissionMap>(readOnlyPermissions());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const existing = role && role !== 'new' ? role : null;

  useEffect(() => {
    if (!role) return;
    setName(existing?.name ?? '');
    setDescription(existing?.description ?? '');
    setPermissions(existing ? scopesToPermissions(existing.permissions) : readOnlyPermissions());
    setError(null);
  }, [role, existing]);

  if (!role) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const payload = { name: name.trim(), description: description.trim(), permissions: permissionsToScopes(permissions) };
    try {
      if (existing) {
        await api.workspaces.updateRole(workspace.id, existing.id, payload);
        onSaved(
          existing.memberCount > 0
            ? `Rôle « ${payload.name} » enregistré : les droits de ${existing.memberCount} membre${existing.memberCount > 1 ? 's' : ''} ont suivi.`
            : `Rôle « ${payload.name} » enregistré.`,
        );
      } else {
        await api.workspaces.createRole(workspace.id, payload);
        onSaved(`Rôle « ${payload.name} » créé. Il est disponible au moment d’inviter ou de modifier un membre.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible d’enregistrer ce rôle.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>{existing ? `Modifier « ${existing.name} »` : 'Nouveau rôle'}</DialogTitle>
            <DialogDescription>
              {existing && existing.memberCount > 0
                ? `${existing.memberCount} membre${existing.memberCount > 1 ? 's suivent' : ' suit'} ce rôle : les changements s’appliquent immédiatement.`
                : 'Choisissez un nom parlant et ce que ce rôle permet, page par page.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="role-name">Nom</Label>
              <Input id="role-name" required minLength={2} maxLength={40} autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Support, Opérateur stockage…" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-description">Description (facultatif)</Label>
              <Input id="role-description" maxLength={160} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Pour qui, et pourquoi" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Droits</Label>
            <PermissionEditor
              value={permissions}
              onChange={setPermissions}
              showIds={false}
              footnote="La modification inclut la lecture. Une page sans accès disparaît du menu. Les paramètres, les membres et les clés API restent réservés aux administrateurs."
            />
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" disabled={saving || name.trim().length < 2} className="gap-1.5">
              {saving && <LoaderCircle className="h-4 w-4 animate-spin" />}
              {existing ? 'Enregistrer' : 'Créer le rôle'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteRoleDialog({
  workspace,
  role,
  onClose,
  onDeleted,
}: {
  workspace: WorkspaceListItem;
  role: WorkspaceCustomRole | null;
  onClose: () => void;
  onDeleted: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [role]);
  if (!role) return null;

  const confirm = async () => {
    setBusy(true);
    try {
      await api.workspaces.deleteRole(workspace.id, role.id);
      onDeleted(`Rôle « ${role.name} » supprimé.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de supprimer ce rôle.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Supprimer « {role.name} » ?</DialogTitle>
          <DialogDescription>
            {role.memberCount > 0
              ? `${role.memberCount} membre${role.memberCount > 1 ? 's gardent' : ' garde'} exactement les mêmes droits, affichés désormais comme « Personnalisé ». Personne ne perd d’accès.`
              : 'Aucun membre ne suit ce rôle.'}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button type="button" variant="destructive" onClick={() => void confirm()} disabled={busy}>
            {busy ? 'Suppression…' : 'Supprimer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
