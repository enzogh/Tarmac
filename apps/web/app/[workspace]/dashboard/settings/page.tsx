'use client';

import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, BellRing, Building2, Eye, Lock, Pencil, Save, Send, Trash2, UserCircle2, Users, type LucideIcon } from 'lucide-react';
import { AdminProfile, api, WorkspaceDetail, WorkspaceListItem } from '../../../../lib/api';
import { API_KEY_RESOURCES, scopesToPermissions } from '../../../../lib/api-key-permissions';
import { usePolling } from '../../../../lib/hooks/usePolling';
import { cn } from '../../../../lib/utils';
import { PageHeader } from '../../../../components/PageHeader';
import { Card, CardContent } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { Badge } from '../../../../components/ui/badge';
import { Alert, AlertDescription } from '../../../../components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../../components/ui/dialog';
import { MembersSection } from './components/MembersSection';
import { RoleBadge, roleOf } from './components/roles';

type SectionId = 'general' | 'members' | 'access' | 'notifications' | 'danger';
type SectionDef = { id: SectionId; label: string; description: string; icon: LucideIcon; group: 'Workspace' | 'Mon compte'; tone?: 'danger' };

const SECTIONS: Record<SectionId, SectionDef> = {
  general: { id: 'general', label: 'Général', description: 'Le nom du workspace, son adresse dans l’URL et le groupe Authentik qui y donne accès.', icon: Building2, group: 'Workspace' },
  members: {
    id: 'members',
    label: 'Membres et rôles',
    description: 'Qui a accès à ce workspace, et ce que chacun peut voir ou modifier, page par page.',
    icon: Users,
    group: 'Workspace',
  },
  access: { id: 'access', label: 'Mon accès', description: 'Ce que votre rôle vous permet de faire dans ce workspace.', icon: Lock, group: 'Workspace' },
  danger: { id: 'danger', label: 'Zone de danger', description: 'Actions définitives sur ce workspace.', icon: AlertTriangle, group: 'Workspace', tone: 'danger' },
  notifications: {
    id: 'notifications',
    label: 'Notifications',
    description: 'Vos alertes par email. Personnel : s’applique à tous vos workspaces.',
    icon: BellRing,
    group: 'Mon compte',
  },
};

export default function WorkspaceSettingsPage() {
  const params = useParams<{ workspace: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: profile, mutate: refreshProfile } = usePolling('profile', api.profile.get, { intervalMs: 60000 });
  const { data: workspaces, mutate: refreshWorkspaces } = usePolling('workspaces', api.workspaces.list, {
    intervalMs: 15000,
  });

  const workspace = workspaces?.find((w) => w.slug === params.workspace || w.id === params.workspace) ?? null;
  const isSuperuser = profile?.isSuperuser ?? false;
  const canManage = isSuperuser || workspace?.myRole === 'owner';

  const available: SectionId[] = canManage
    ? ['general', 'members', 'notifications', ...(workspace?.isDefault ? [] : (['danger'] as SectionId[]))]
    : ['access', 'notifications'];
  const requested = searchParams.get('section') as SectionId | null;
  const active: SectionId = requested && available.includes(requested) ? requested : available[0];
  // The section lives in the URL: shareable ("go to Settings → Members"),
  // and the browser's back button walks between sections.
  const select = (id: SectionId) => router.replace(`${pathname}?section=${id}`, { scroll: false });

  if (!workspaces || !profile || !workspace) {
    return (
      <div className="space-y-6">
        <PageHeader title="Paramètres" description="Chargement…" />
      </div>
    );
  }

  const section = SECTIONS[active];
  const groups = (['Workspace', 'Mon compte'] as const).map((group) => ({
    group,
    items: available.map((id) => SECTIONS[id]).filter((item) => item.group === group),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Paramètres"
        description={canManage ? `Configurez « ${workspace.name} », ses membres et leurs droits.` : `Votre accès à « ${workspace.name} » et vos préférences.`}
        meta={<RoleBadge choice={canManage ? 'admin' : roleOf(workspace.myRole ?? 'member', workspace.myPermissions)} />}
      />

      <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label="Sections des paramètres" className="min-w-0 lg:sticky lg:top-0 lg:self-start">
          {/* Phone: one scrollable row of pills. Desktop: a vertical list
              grouped like the sidebar, so the page has the same shape as
              the rest of the app. */}
          <div className="scroll-thin -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:gap-4 lg:overflow-visible lg:px-0">
            {groups.map(({ group, items }) =>
              items.length === 0 ? null : (
                <div key={group} className="contents lg:block lg:space-y-0.5">
                  <p className="hidden px-3 pb-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground/60 lg:block">{group}</p>
                  {items.map((item) => {
                    const isActive = item.id === active;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => select(item.id)}
                        aria-current={isActive ? 'page' : undefined}
                        className={cn(
                          'relative flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border px-3 py-1.5 text-sm transition-colors lg:w-full lg:border-transparent',
                          isActive
                            ? 'border-primary/40 bg-surface-2 font-medium text-foreground'
                            : 'border-border text-muted-foreground hover:bg-surface-2/60 hover:text-foreground',
                          item.tone === 'danger' && !isActive && 'text-[hsl(var(--danger))]/80 hover:text-[hsl(var(--danger))]',
                        )}
                      >
                        {isActive && <span className="absolute inset-y-1 left-0 hidden w-0.5 rounded-full bg-primary lg:block" aria-hidden />}
                        <item.icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-primary' : 'opacity-70', item.tone === 'danger' && 'text-[hsl(var(--danger))]')} />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              ),
            )}
          </div>
        </nav>

        <section key={active} className="min-w-0 max-w-4xl animate-fade-in space-y-4" aria-labelledby="settings-section-title">
          <div>
            <h2 id="settings-section-title" className={cn('text-base font-semibold text-foreground', section.tone === 'danger' && 'text-[hsl(var(--danger))]')}>
              {section.label}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{section.description}</p>
          </div>

          {active === 'general' && (
            <GeneralCard
              workspace={workspace}
              onSaved={(updated) => {
                void refreshWorkspaces();
                // The page lives under the slug: follow it to its new address.
                if (updated.slug !== params.workspace) router.replace(`/${updated.slug}/dashboard/settings?section=general`);
              }}
            />
          )}
          {active === 'members' && (
            <MembersSection
              workspace={workspace}
              currentUserId={profile.id}
              isSuperuser={isSuperuser}
              onMembershipChanged={() => void refreshWorkspaces()}
            />
          )}
          {active === 'access' && <MyAccessCard workspace={workspace} />}
          {active === 'notifications' && <EmailNotificationsCard profile={profile} onSaved={() => void refreshProfile()} />}
          {active === 'danger' && (
            <DangerZoneCard
              workspace={workspace}
              onDeleted={() => {
                void refreshWorkspaces();
                router.push('/workspaces');
              }}
            />
          )}
        </section>
      </div>
    </div>
  );
}

// A member's own role, page by page: the answer to "why can't I click
// that?" without having to ask an administrator.
function MyAccessCard({ workspace }: { workspace: WorkspaceListItem }) {
  const permissions = scopesToPermissions(workspace.myPermissions);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <span className="flex items-center gap-2 text-sm text-foreground">
          <UserCircle2 className="h-4 w-4 text-muted-foreground" />
          Votre rôle
        </span>
        <RoleBadge choice={roleOf(workspace.myRole ?? 'member', workspace.myPermissions)} />
      </div>
      <ul className="divide-y divide-border">
        {API_KEY_RESOURCES.map((resource) => {
          const level = permissions[resource.id];
          return (
            <li key={resource.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span className="flex min-w-0 items-center gap-2.5">
                <resource.icon className={cn('h-4 w-4 shrink-0', level === 'none' ? 'text-muted-foreground/50' : 'text-primary')} />
                <span className="min-w-0">
                  <span className={cn('block text-sm', level === 'none' ? 'text-muted-foreground' : 'text-foreground')}>{resource.label}</span>
                  <span className="block text-2xs text-muted-foreground">{level === 'write' ? resource.write : level === 'read' ? resource.read : 'Page masquée du menu.'}</span>
                </span>
              </span>
              <span
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-2xs font-medium',
                  level === 'write' && 'border-primary/30 bg-primary/10 text-primary',
                  level === 'read' && 'border-[hsl(var(--info))]/25 bg-[hsl(var(--info))]/10 text-[hsl(var(--info))]',
                  level === 'none' && 'border-border text-muted-foreground',
                )}
              >
                {level === 'write' ? <Pencil className="h-3 w-3" /> : level === 'read' ? <Eye className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                {level === 'write' ? 'Modification' : level === 'read' ? 'Lecture' : 'Aucun accès'}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-border bg-surface-2/40 px-4 py-2.5 text-2xs text-muted-foreground">
        Besoin de plus ? Un administrateur du workspace peut changer votre rôle dans Paramètres → Membres et rôles.
      </p>
    </Card>
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
      <CardContent className="space-y-4 pt-5">
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

// Same rules as the API (UpdateWorkspaceDto): lowercase letters, digits and
// single hyphens. Typing is normalised as you go so the preview is what the
// API will accept.
function toSlug(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '');
}

// A slug change moves this page to a new URL, which remounts it: the
// confirmation is handed over through sessionStorage to survive that.
const NOTICE_KEY = 'tarmac.settings.notice';

function GeneralCard({ workspace, onSaved }: { workspace: WorkspaceListItem; onSaved: (updated: WorkspaceDetail) => void }) {
  const [name, setName] = useState(workspace.name);
  const [slug, setSlug] = useState(workspace.slug);
  const [ssoGroup, setSsoGroup] = useState(workspace.ssoGroupClaim ?? '');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    try {
      const pending = sessionStorage.getItem(NOTICE_KEY);
      if (pending) {
        sessionStorage.removeItem(NOTICE_KEY);
        setNotice({ type: 'success', message: pending });
      }
    } catch {
      // Storage unavailable: the redirect itself shows the change.
    }
  }, []);

  useEffect(() => {
    setName(workspace.name);
    setSlug(workspace.slug);
    setSsoGroup(workspace.ssoGroupClaim ?? '');
  }, [workspace.name, workspace.slug, workspace.ssoGroupClaim]);

  const finalSlug = slug.replace(/-+$/, '');
  const nameChanged = name.trim() !== workspace.name;
  const slugChanged = finalSlug !== workspace.slug;
  const ssoGroupChanged = ssoGroup.trim() !== (workspace.ssoGroupClaim ?? '');
  const slugInvalid = finalSlug.length < 2 || finalSlug.length > 48;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!nameChanged && !slugChanged && !ssoGroupChanged) return;
    setSaving(true);
    setNotice(null);
    try {
      const updated = await api.workspaces.update(workspace.id, {
        ...(nameChanged ? { name: name.trim() } : {}),
        ...(slugChanged ? { slug: finalSlug } : {}),
        ...(ssoGroupChanged ? { ssoGroupClaim: ssoGroup.trim() } : {}),
      });
      const message = slugChanged
        ? `Enregistré. L'ancienne adresse /${workspace.slug} redirige désormais vers /${updated.slug}.`
        : 'Enregistré.';
      setNotice({ type: 'success', message });
      if (slugChanged) {
        try {
          sessionStorage.setItem(NOTICE_KEY, message);
        } catch {
          // Best effort, see NOTICE_KEY.
        }
      }
      onSaved(updated);
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Impossible de mettre à jour ce workspace.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="pt-5">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="workspace-name">Nom</Label>
              <Input id="workspace-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
              <p className="text-xs text-muted-foreground">Affiché dans la barre latérale, les e-mails et le journal.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="workspace-slug">Identifiant dans l&apos;URL</Label>
              <Input
                id="workspace-slug"
                value={slug}
                onChange={(e) => setSlug(toSlug(e.target.value))}
                maxLength={48}
                spellCheck={false}
                className="font-mono"
              />
              <p className="truncate text-xs text-muted-foreground" title={`${origin}/${finalSlug}/dashboard`}>
                <span className="font-mono">
                  {origin}/<span className="text-foreground">{finalSlug || '…'}</span>/dashboard
                </span>
              </p>
            </div>
          </div>
          <div className="space-y-2 sm:w-1/2 sm:pr-2">
            <Label htmlFor="workspace-sso-group">Groupe Authentik</Label>
            <Input
              id="workspace-sso-group"
              value={ssoGroup}
              onChange={(e) => setSsoGroup(e.target.value)}
              placeholder="Aucun"
              maxLength={200}
              spellCheck={false}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Toute personne membre de ce groupe dans Authentik devient membre à sa prochaine connexion.
            </p>
          </div>
          {slugChanged && !slugInvalid && (
            <Alert variant="info">
              <AlertDescription>
                Les agents ne sont pas concernés : ils sont identifiés par leur nœud, jamais par le slug. Les anciens
                liens en <span className="font-mono">/{workspace.slug}/…</span> (favoris, e-mails d&apos;alerte)
                continueront de rediriger ici.
              </AlertDescription>
            </Alert>
          )}
          {slugInvalid && <p className="text-xs text-[hsl(var(--danger))]">L&apos;identifiant doit faire entre 2 et 48 caractères.</p>}
          <div className="flex justify-end">
            <Button type="submit" disabled={saving || (!nameChanged && !slugChanged && !ssoGroupChanged) || slugInvalid || name.trim().length < 2} className="gap-2">
              <Save className="h-4 w-4" />
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </div>
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

function DangerZoneCard({ workspace, onDeleted }: { workspace: WorkspaceListItem; onDeleted: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState('');
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
    <Card className="border-[hsl(var(--danger))]/25">
      <CardContent className="flex flex-col gap-4 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-foreground">Supprimer ce workspace</p>
          <p className="text-xs text-muted-foreground">
            Supprime définitivement « {workspace.name} », ses membres et sa configuration réseau. Possible seulement une fois
            vide : retirez d&apos;abord ses nœuds, pools, partages et autres ressources.
          </p>
        </div>
        <Button variant="destructive" className="shrink-0 gap-2" onClick={() => setConfirmOpen(true)}>
          <Trash2 className="h-4 w-4" />
          Supprimer…
        </Button>
      </CardContent>
      {error && (
        <div className="px-5 pb-5">
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          setTyped('');
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Supprimer « {workspace.name} » ?</DialogTitle>
            <DialogDescription>Cette action est irréversible.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="confirm-workspace-name" className="text-xs font-normal text-muted-foreground">
              Tapez <span className="font-mono font-medium text-foreground">{workspace.name}</span> pour confirmer
            </Label>
            <Input id="confirm-workspace-name" value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" />
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)} disabled={deleting}>
              Annuler
            </Button>
            <Button type="button" variant="destructive" onClick={() => void confirmDelete()} disabled={deleting || typed.trim() !== workspace.name}>
              {deleting ? 'Suppression…' : 'Supprimer définitivement'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
