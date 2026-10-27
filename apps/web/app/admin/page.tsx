'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Ban,
  Building2,
  ChevronRight,
  Crown,
  Gauge,
  GitBranch,
  History,
  Info,
  LoaderCircle,
  LogOut,
  Mail,
  Minus,
  Monitor,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  SlidersHorizontal,
  TriangleAlert,
  UserCheck,
  Users,
} from 'lucide-react';
import { AdminSettings, AdminUser, AdminUserDetail, api, ApiError, EmailTemplatePreview, WorkspaceMember } from '../../lib/api';
import { formatDateTime, formatRelative } from '../../lib/format';
import { usePolling } from '../../lib/hooks/usePolling';
import { cn } from '../../lib/utils';
import { BrandMark } from '../../components/BrandMark';
import { GithubPanel } from './GithubPanel';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '../../components/ui/sheet';
import { Stat, StatRow } from '../../components/ui/stat';
import { Tabs, TabsCount, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip';

type Tab = 'users' | 'emails' | 'github' | 'settings';
type Filter = 'all' | 'access' | 'none' | 'full' | 'disabled';

const MAX_LIMIT = 100;

const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? 's' : ''}`;

const initials = (user: { name?: string | null; email: string }) =>
  (user.name || user.email)
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');

// Same palette and hashing as the workspace members list, so a person keeps
// one colour everywhere.
const AVATAR_TONES = [
  'bg-[hsl(var(--chart-1))]/20 text-[hsl(var(--chart-1))]',
  'bg-[hsl(var(--chart-2))]/20 text-[hsl(var(--chart-2))]',
  'bg-[hsl(var(--chart-3))]/20 text-[hsl(var(--chart-3))]',
  'bg-[hsl(var(--chart-4))]/20 text-[hsl(var(--chart-4))]',
  'bg-[hsl(var(--chart-5))]/20 text-[hsl(var(--chart-5))]',
];
const avatarTone = (id: string) => AVATAR_TONES[[...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % AVATAR_TONES.length];

function Avatar({ user, size = 'md' }: { user: { id: string; name?: string | null; email: string; avatarUrl?: string | null }; size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-11 w-11 text-sm' : 'h-9 w-9 text-xs';
  if (user.avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={user.avatarUrl} alt="" className={cn('shrink-0 rounded-full object-cover', box)} />;
  }
  return <span className={cn('flex shrink-0 items-center justify-center rounded-full font-semibold', box, avatarTone(user.id))}>{initials(user)}</span>;
}

const isFull = (user: AdminUser) => !user.isSuperuser && user.canCreateWorkspaces && user.createdCount >= user.effectiveLimit;
const hasAccess = (user: AdminUser) => !user.disabledAt && (user.canCreateWorkspaces || user.isSuperuser);

function StatusBadge({ user }: { user: Pick<AdminUser, 'isSuperuser' | 'canCreateWorkspaces' | 'disabledAt'> }) {
  if (user.disabledAt) {
    return (
      <Badge variant="destructive">
        <Ban className="h-3 w-3" />
        Désactivé
      </Badge>
    );
  }
  if (user.isSuperuser) {
    return (
      <Badge variant="info">
        <ShieldCheck className="h-3 w-3" />
        Administrateur
      </Badge>
    );
  }
  if (user.canCreateWorkspaces) return <Badge variant="success">Accès Tarmac</Badge>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Badge variant="secondary">Sans accès</Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent>Hors du groupe d’accès Tarmac sur Authentik</TooltipContent>
    </Tooltip>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={null}>
      <AdminPageContent />
    </Suspense>
  );
}

function AdminPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: profile } = usePolling('profile', api.profile.get, { intervalMs: 60000 });
  const isSuperuser = profile?.isSuperuser ?? false;

  const requested = searchParams.get('tab') as Tab | null;
  const tab: Tab = requested && ['users', 'emails', 'github', 'settings'].includes(requested) ? requested : 'users';
  const selectTab = (next: Tab) => router.replace(`${pathname}?tab=${next}`, { scroll: false });

  // The API refuses anyone else anyway; this only keeps them off a page
  // that would stay empty.
  useEffect(() => {
    if (profile && !profile.isSuperuser) router.replace('/workspaces');
  }, [profile, router]);

  const handleLogout = async () => {
    try {
      await api.logout();
    } finally {
      router.push('/login');
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex min-h-screen flex-col bg-background">
        <header className="border-b border-border">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
            <span className="flex min-w-0 items-center gap-2">
              <BrandMark />
              <span className="text-sm font-semibold tracking-tight text-foreground">Tarmac</span>
              <span className="text-sm text-muted-foreground/50">/</span>
              <span className="truncate text-sm text-muted-foreground">Administration</span>
            </span>
            <Button variant="ghost" size="sm" onClick={() => void handleLogout()} className="gap-2">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Déconnexion</span>
            </Button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-8 sm:px-6 sm:py-10">
          <div>
            <Link href="/workspaces" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
              <ArrowLeft className="h-3.5 w-3.5" />
              Mes workspaces
            </Link>
            <h1 className="mt-3 flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Administration de la plateforme
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Les comptes, les emails envoyés par Tarmac, le dépôt GitHub des nœuds et les réglages communs à tous les workspaces. Réservé aux administrateurs.
            </p>
          </div>

          <Tabs value={tab} onValueChange={(value) => selectTab(value as Tab)}>
            <TabsList>
              <TabsTrigger value="users" className="gap-1.5">
                <Users className="h-4 w-4" />
                Utilisateurs
              </TabsTrigger>
              <TabsTrigger value="emails" className="gap-1.5">
                <Mail className="h-4 w-4" />
                Emails
              </TabsTrigger>
              <TabsTrigger value="github" className="gap-1.5">
                <GitBranch className="h-4 w-4" />
                GitHub
              </TabsTrigger>
              <TabsTrigger value="settings" className="gap-1.5">
                <Settings2 className="h-4 w-4" />
                Paramètres
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {isSuperuser && tab === 'users' && <UsersPanel currentUserId={profile?.id ?? ''} onOpenSettings={() => selectTab('settings')} />}
          {isSuperuser && tab === 'emails' && <EmailsPanel />}
          {isSuperuser && tab === 'github' && <GithubPanel />}
          {isSuperuser && tab === 'settings' && <SettingsPanel />}
          {!profile && (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Chargement…
            </div>
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}

// --- Users -----------------------------------------------------------------

function UsersPanel({ currentUserId, onOpenSettings }: { currentUserId: string; onOpenSettings: () => void }) {
  const { data, error, isLoading, mutate } = usePolling('admin:users', api.admin.listUsers, { intervalMs: 30000 });
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const users = useMemo(() => data?.users ?? [], [data]);
  const counts = useMemo(
    () => ({
      all: users.length,
      access: users.filter(hasAccess).length,
      none: users.filter((user) => !user.disabledAt && !user.canCreateWorkspaces && !user.isSuperuser).length,
      full: users.filter(isFull).length,
      disabled: users.filter((user) => !!user.disabledAt).length,
    }),
    [users],
  );
  const created = users.reduce((sum, user) => sum + user.createdCount, 0);

  const needle = query.trim().toLowerCase();
  const shown = users.filter((user) => {
    if (filter === 'access' && !hasAccess(user)) return false;
    if (filter === 'none' && (user.disabledAt || user.canCreateWorkspaces || user.isSuperuser)) return false;
    if (filter === 'full' && !isFull(user)) return false;
    if (filter === 'disabled' && !user.disabledAt) return false;
    return !needle || user.email.toLowerCase().includes(needle) || (user.name ?? '').toLowerCase().includes(needle);
  });
  const openedUser = users.find((user) => user.id === opened) ?? null;

  const changed = (message: string) => {
    setNotice(message);
    void mutate();
  };

  return (
    <div className="space-y-6">
      <StatRow>
        <Stat label="Utilisateurs" value={data ? counts.all : '—'} icon={Users} hint="connectés au moins une fois" />
        <Stat label="Accès Tarmac" value={data ? counts.access : '—'} icon={UserCheck} tone="ok" hint="groupe d’accès ou administrateur" />
        <Stat label="Workspaces créés" value={data ? created : '—'} icon={Building2} hint="par les utilisateurs listés" />
        <Stat
          label="Limite par défaut"
          value={data ? data.defaultLimit : '—'}
          unit="par personne"
          icon={Gauge}
          tone="info"
          hint={
            <button type="button" onClick={onOpenSettings} className="inline-flex items-center gap-0.5 text-primary hover:underline">
              Modifier
              <ChevronRight className="h-3 w-3" />
            </button>
          }
        />
      </StatRow>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={filter}
          onValueChange={(value) => setFilter(value as Filter)}
          className="-mx-4 w-[calc(100%+2rem)] overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:w-auto sm:px-0 [&::-webkit-scrollbar]:hidden"
        >
          <TabsList variant="segmented">
            <TabsTrigger value="all">
              Tous <TabsCount>{counts.all}</TabsCount>
            </TabsTrigger>
            <TabsTrigger value="access">
              Avec accès <TabsCount>{counts.access}</TabsCount>
            </TabsTrigger>
            <TabsTrigger value="none">
              Sans accès <TabsCount>{counts.none}</TabsCount>
            </TabsTrigger>
            <TabsTrigger value="full">
              Limite atteinte <TabsCount>{counts.full}</TabsCount>
            </TabsTrigger>
            {counts.disabled > 0 && (
              <TabsTrigger value="disabled">
                Désactivés <TabsCount>{counts.disabled}</TabsCount>
              </TabsTrigger>
            )}
          </TabsList>
        </Tabs>
        <span className="flex-1" />
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher par nom ou e-mail…" className="h-8 pl-8" />
        </div>
      </div>

      {notice && (
        <Alert variant="success">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>Impossible de charger les utilisateurs.</AlertDescription>
        </Alert>
      )}

      <Card className="overflow-hidden">
        {isLoading && !data ? (
          <div className="flex items-center gap-2 px-4 py-10 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            Chargement des utilisateurs…
          </div>
        ) : shown.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">Aucun utilisateur ne correspond.</p>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((user) => (
              <UserRow key={user.id} user={user} isSelf={user.id === currentUserId} onOpen={() => setOpened(user.id)} onEdit={() => setEditing(user)} />
            ))}
          </ul>
        )}
      </Card>

      <p className="flex items-start gap-2 text-2xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        L’accès à Tarmac se gère dans Authentik (groupe d’accès). Seuls comptent les workspaces qu’une personne possède : ceux où elle est invitée
        n’entrent pas dans sa limite, et en supprimer ou en transférer un libère une place. Cliquez sur une personne pour voir ses workspaces et son
        historique.
      </p>

      {data && (
        <LimitDialog
          user={editing}
          defaultLimit={data.defaultLimit}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            changed(message);
          }}
        />
      )}
      <UserSheet
        user={openedUser}
        isSelf={openedUser?.id === currentUserId}
        onClose={() => setOpened(null)}
        onEditLimit={() => openedUser && setEditing(openedUser)}
        onChanged={changed}
      />
    </div>
  );
}

function UserRow({ user, isSelf, onOpen, onEdit }: { user: AdminUser; isSelf: boolean; onOpen: () => void; onEdit: () => void }) {
  const full = isFull(user);
  const percent = user.effectiveLimit > 0 ? Math.min(100, (user.createdCount / user.effectiveLimit) * 100) : 100;

  return (
    <li className={cn('flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3.5 transition-colors hover:bg-surface-2/50 sm:flex-nowrap', user.disabledAt && 'opacity-70')}>
      <button type="button" onClick={onOpen} className="group flex min-w-0 flex-1 items-center gap-3 text-left">
        <Avatar user={user} />
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
            <span className="truncate group-hover:underline">{user.name || user.email}</span>
            {isSelf && <span className="shrink-0 rounded bg-surface-3 px-1.5 py-px text-2xs font-normal text-muted-foreground">vous</span>}
          </p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
      </button>

      <div className="flex w-full items-center gap-3 pl-12 sm:w-auto sm:gap-6 sm:pl-0">
        <div className="hidden w-28 shrink-0 md:block">
          <StatusBadge user={user} />
        </div>

        <div className="w-36 shrink-0 sm:w-40">
          {user.isSuperuser ? (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium tabular-nums text-foreground">{user.createdCount}</span> créé{user.createdCount > 1 ? 's' : ''} · sans limite
            </p>
          ) : (
            <>
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-muted-foreground">
                  <span className={cn('font-medium tabular-nums', full ? 'text-[hsl(var(--warn))]' : 'text-foreground')}>{user.createdCount}</span>
                  <span className="tabular-nums"> / {user.effectiveLimit}</span> créés
                </span>
                {user.workspaceLimit !== null && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <SlidersHorizontal className="h-3 w-3 text-primary" aria-label="Limite personnalisée" />
                    </TooltipTrigger>
                    <TooltipContent>Limite personnalisée</TooltipContent>
                  </Tooltip>
                )}
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3">
                <div className={cn('h-full rounded-full transition-all', full ? 'bg-[hsl(var(--warn))]' : 'bg-primary')} style={{ width: `${percent}%` }} />
              </div>
            </>
          )}
          <p className="mt-1 text-2xs text-muted-foreground">
            {user.isSuperuser ? 'Accès à tous les workspaces' : `Membre de ${plural(user.membershipCount, 'workspace')}`}
          </p>
        </div>

        <span className="flex-1 sm:hidden" />
        {user.isSuperuser ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button variant="secondary" size="sm" disabled className="h-8 gap-1.5 sm:w-[7.5rem]">
                  <Gauge className="h-3.5 w-3.5" />
                  Illimité
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>Les administrateurs créent sans limite</TooltipContent>
          </Tooltip>
        ) : (
          <Button variant="secondary" size="sm" onClick={onEdit} className="h-8 gap-1.5 sm:w-[7.5rem]">
            <Gauge className="h-3.5 w-3.5" />
            Limite
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onOpen} className="h-8 w-8 p-0" aria-label={`Détails de ${user.email}`}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </li>
  );
}

const HISTORY_LABEL: Record<string, (details: Record<string, unknown> | null) => string> = {
  'admin.user.limit': (details) => {
    const show = (value: unknown) => (value === null || value === undefined ? 'par défaut' : String(value));
    return `Limite de création : ${show(details?.before)} → ${show(details?.after)}`;
  },
  'admin.user.disable': () => 'Compte désactivé',
  'admin.user.enable': () => 'Compte réactivé',
  'admin.user.access-revoked': () => 'Accès retiré automatiquement : n’est plus dans le groupe d’accès Authentik',
};

function UserSheet({
  user,
  isSelf,
  onClose,
  onEditLimit,
  onChanged,
}: {
  user: AdminUser | null;
  isSelf: boolean;
  onClose: () => void;
  onEditLimit: () => void;
  onChanged: (message: string) => void;
}) {
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [transferFor, setTransferFor] = useState<AdminUserDetail['workspaces'][number] | null>(null);

  const load = async (id: string) => {
    try {
      setDetail(await api.admin.getUser(id));
      setError(null);
    } catch {
      setError('Impossible de charger le détail de ce compte.');
    }
  };

  useEffect(() => {
    setDetail(null);
    setError(null);
    if (user) void load(user.id);
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const owned = detail?.workspaces.filter((workspace) => workspace.isOwner) ?? [];

  return (
    <Sheet open={!!user} onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        {user && (
          <>
            <SheetHeader>
              <div className="flex items-center gap-3">
                <Avatar user={user} size="lg" />
                <div className="min-w-0">
                  <SheetTitle className="truncate">{user.name || user.email}</SheetTitle>
                  <SheetDescription className="truncate">{user.email}</SheetDescription>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <StatusBadge user={user} />
                {user.workspaceLimit !== null && !user.isSuperuser && <Badge variant="outline">Limite personnalisée</Badge>}
              </div>
            </SheetHeader>
            <SheetBody className="space-y-6">
              {user.disabledAt && (
                <Alert variant="warning">
                  <AlertDescription>
                    Compte désactivé le {formatDateTime(user.disabledAt)} : il ne peut plus se connecter et ses sessions ont été coupées.
                  </AlertDescription>
                </Alert>
              )}

              <dl className="grid grid-cols-2 gap-3">
                {[
                  ['Workspaces créés', user.isSuperuser ? `${user.createdCount} · sans limite` : `${user.createdCount} / ${user.effectiveLimit}`],
                  ['Membre de', user.isSuperuser ? 'tous les workspaces' : plural(user.membershipCount, 'workspace')],
                  ['Première connexion', formatDateTime(user.createdAt)],
                  ['Accès vérifié', user.isSuperuser ? 'administrateur' : user.accessCheckedAt ? formatRelative(user.accessCheckedAt) : 'à la connexion'],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-border bg-surface-2 px-3 py-2.5">
                    <dt className="text-2xs uppercase tracking-wider text-muted-foreground">{label}</dt>
                    <dd className="mt-0.5 text-sm text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>

              <section className="space-y-2">
                <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  Workspaces
                </h3>
                {error && <p className="text-xs text-[hsl(var(--danger))]">{error}</p>}
                {!detail && !error ? (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    Chargement…
                  </p>
                ) : detail && detail.workspaces.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                    Membre d’aucun workspace pour l’instant.
                  </p>
                ) : (
                  <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                    {detail?.workspaces.map((workspace) => (
                      <li key={workspace.id} className="flex items-center gap-3 px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5 truncate text-sm text-foreground">
                            <span className="truncate">{workspace.name}</span>
                            {workspace.isOwner && <Crown className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--warn))]" aria-label="Propriétaire" />}
                          </p>
                          <p className="truncate text-2xs text-muted-foreground">
                            {[workspace.isOwner ? 'Propriétaire' : workspace.roleLabel, plural(workspace.nodeCount, 'nœud'), plural(workspace.memberCount, 'membre')]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        </div>
                        {workspace.isOwner && (
                          <Button variant="secondary" size="sm" className="h-7 gap-1 text-xs" onClick={() => setTransferFor(workspace)}>
                            <Crown className="h-3 w-3" />
                            Transférer
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {user.disabledAt && owned.length > 0 && (
                  <p className="text-2xs text-[hsl(var(--warn))]">
                    Ce compte possède encore {plural(owned.length, 'workspace')} : transférez-les à un autre membre pour qu’ils restent suivis.
                  </p>
                )}
              </section>

              <section className="space-y-2">
                <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <History className="h-4 w-4 text-muted-foreground" />
                  Historique
                </h3>
                {detail && detail.history.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Aucune modification par un administrateur.</p>
                ) : (
                  <ol className="space-y-3 border-l border-border pl-4">
                    {detail?.history.map((entry) => (
                      <li key={entry.id} className="relative">
                        <span className="absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full bg-primary/70 ring-4 ring-popover" />
                        <p className="text-sm text-foreground">{HISTORY_LABEL[entry.action]?.(entry.details) ?? entry.action}</p>
                        <p className="text-2xs text-muted-foreground">
                          {formatDateTime(entry.createdAt)} · {entry.actor ? `par ${entry.actor}` : 'automatique'}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </SheetBody>
            <SheetFooter>
              {!user.isSuperuser && (
                <Button variant="secondary" size="sm" className="gap-1.5" onClick={onEditLimit}>
                  <Gauge className="h-3.5 w-3.5" />
                  Modifier la limite
                </Button>
              )}
              <span className="flex-1" />
              {user.disabledAt ? (
                <Button size="sm" className="gap-1.5" onClick={() => setConfirmDisable(true)}>
                  <UserCheck className="h-3.5 w-3.5" />
                  Réactiver le compte
                </Button>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button variant="destructive" size="sm" className="gap-1.5" disabled={isSelf} onClick={() => setConfirmDisable(true)}>
                        <ShieldOff className="h-3.5 w-3.5" />
                        Désactiver le compte
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {isSelf && <TooltipContent>Vous ne pouvez pas désactiver votre propre compte.</TooltipContent>}
                </Tooltip>
              )}
            </SheetFooter>

            <DisableDialog
              user={confirmDisable ? user : null}
              onClose={() => setConfirmDisable(false)}
              onDone={(message) => {
                setConfirmDisable(false);
                onChanged(message);
                void load(user.id);
              }}
            />
            <AdminTransferDialog
              workspace={transferFor}
              fromUserId={user.id}
              onClose={() => setTransferFor(null)}
              onDone={(message) => {
                setTransferFor(null);
                onChanged(message);
                void load(user.id);
              }}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DisableDialog({ user, onClose, onDone }: { user: AdminUser | null; onClose: () => void; onDone: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [user]);
  if (!user) return null;
  const disabling = !user.disabledAt;

  const confirm = async () => {
    setBusy(true);
    try {
      await api.admin.updateUser(user.id, { disabled: disabling });
      onDone(disabling ? `${user.email} est désactivé : ses sessions sont coupées.` : `${user.email} peut de nouveau se connecter.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de modifier ce compte.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{disabling ? `Désactiver ${user.name || user.email} ?` : `Réactiver ${user.name || user.email} ?`}</DialogTitle>
          <DialogDescription>
            {disabling
              ? 'La personne est déconnectée dans la minute et ne peut plus se connecter à Tarmac, même si Authentik l’y autorise encore. Ses workspaces et ses rôles sont conservés.'
              : 'La personne pourra se reconnecter, à condition de faire partie du groupe d’accès Tarmac. Ses workspaces et ses rôles sont inchangés.'}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button variant={disabling ? 'destructive' : 'default'} onClick={() => void confirm()} disabled={busy}>
            {busy ? 'Enregistrement…' : disabling ? 'Désactiver' : 'Réactiver'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdminTransferDialog({
  workspace,
  fromUserId,
  onClose,
  onDone,
}: {
  workspace: AdminUserDetail['workspaces'][number] | null;
  fromUserId: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [target, setTarget] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMembers(null);
    setTarget('');
    setError(null);
    if (!workspace) return;
    api.workspaces
      .listMembers(workspace.id)
      .then((list) => setMembers(list.filter((member) => member.userId !== fromUserId)))
      .catch(() => setError('Impossible de charger les membres de ce workspace.'));
  }, [workspace, fromUserId]);

  if (!workspace) return null;
  const chosen = members?.find((member) => member.userId === target) ?? null;

  const confirm = async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      await api.admin.transferWorkspace(workspace.id, chosen.userId);
      onDone(`« ${workspace.name} » appartient maintenant à ${chosen.user.email}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de transférer ce workspace.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Transférer « {workspace.name} »</DialogTitle>
          <DialogDescription>Choisissez le nouveau propriétaire parmi les membres. En tant qu’administrateur, sa limite de création ne vous bloque pas.</DialogDescription>
        </DialogHeader>
        {members === null && !error ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            Chargement des membres…
          </p>
        ) : members && members.length === 0 ? (
          <Alert variant="warning">
            <AlertDescription>Aucun autre membre dans ce workspace : invitez d’abord la personne qui doit le reprendre.</AlertDescription>
          </Alert>
        ) : (
          <div className="max-h-72 space-y-1.5 overflow-y-auto" role="radiogroup" aria-label="Nouveau propriétaire">
            {members?.map((member) => (
              <button
                key={member.userId}
                type="button"
                role="radio"
                aria-checked={target === member.userId}
                onClick={() => setTarget(member.userId)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-colors',
                  target === member.userId ? 'border-primary/60 bg-primary/5' : 'border-border hover:bg-surface-2',
                )}
              >
                <Avatar user={member.user} />
                <span className="min-w-0">
                  <span className="block truncate text-sm text-foreground">{member.user.name || member.user.email}</span>
                  <span className="block truncate text-2xs text-muted-foreground">{member.user.email}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Annuler
          </Button>
          <Button onClick={() => void confirm()} disabled={busy || !chosen} className="gap-1.5">
            <Crown className="h-4 w-4" />
            {busy ? 'Transfert…' : 'Transférer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stepper({ value, onChange, min = 0, max = MAX_LIMIT, label }: { value: number; onChange: (next: number) => void; min?: number; max?: number; label: string }) {
  const clamp = (next: number) => onChange(Math.max(min, Math.min(max, Number.isFinite(next) ? next : min)));
  return (
    <span className="flex items-center gap-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        aria-label="Diminuer"
        className="h-8 w-8 p-0"
        disabled={value <= min}
        onClick={(event) => {
          event.stopPropagation();
          clamp(value - 1);
        }}
      >
        <Minus className="h-3.5 w-3.5" />
      </Button>
      <Input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => clamp(Number.parseInt(event.target.value, 10))}
        className="h-8 w-16 text-center tabular-nums"
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        aria-label="Augmenter"
        className="h-8 w-8 p-0"
        disabled={value >= max}
        onClick={(event) => {
          event.stopPropagation();
          clamp(value + 1);
        }}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
      <span className="text-xs text-muted-foreground">workspace{value > 1 ? 's' : ''}</span>
    </span>
  );
}

function LimitDialog({
  user,
  defaultLimit,
  onClose,
  onSaved,
}: {
  user: AdminUser | null;
  defaultLimit: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [mode, setMode] = useState<'default' | 'custom'>('default');
  const [value, setValue] = useState(defaultLimit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setMode(user.workspaceLimit === null ? 'default' : 'custom');
    setValue(user.workspaceLimit ?? defaultLimit);
    setError(null);
  }, [user, defaultLimit]);

  if (!user) return null;

  const limit = mode === 'default' ? defaultLimit : value;
  const remaining = Math.max(0, limit - user.createdCount);
  const unchanged = (mode === 'default' ? null : value) === user.workspaceLimit;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.admin.updateUser(user.id, { workspaceLimit: mode === 'default' ? null : value });
      onSaved(
        mode === 'default'
          ? `${user.email} suit de nouveau la limite par défaut (${defaultLimit}).`
          : value === 0
            ? `${user.email} ne peut plus créer de workspace.`
            : `${user.email} peut désormais créer jusqu’à ${plural(value, 'workspace')}.`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible d’enregistrer cette limite.');
    } finally {
      setSaving(false);
    }
  };

  const option = (selected: boolean) =>
    cn('flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors', selected ? 'border-primary/60 bg-primary/5' : 'border-border hover:bg-surface-2');
  const radio = (selected: boolean) =>
    cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', selected ? 'border-primary' : 'border-muted-foreground/40');

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Limite de création</DialogTitle>
          <DialogDescription>Combien de workspaces cette personne peut posséder.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-3">
            <Avatar user={user} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{user.name || user.email}</p>
              <p className="truncate text-xs text-muted-foreground">
                {user.createdCount} créé{user.createdCount > 1 ? 's' : ''} · membre de {plural(user.membershipCount, 'workspace')}
              </p>
            </div>
          </div>

          <div className="space-y-2" role="radiogroup" aria-label="Limite">
            <button type="button" role="radio" aria-checked={mode === 'default'} onClick={() => setMode('default')} className={option(mode === 'default')}>
              <span className={radio(mode === 'default')}>{mode === 'default' && <span className="h-2 w-2 rounded-full bg-primary" />}</span>
              <span>
                <span className="block text-sm font-medium text-foreground">Limite par défaut</span>
                <span className="block text-xs text-muted-foreground">{plural(defaultLimit, 'workspace')}, et suit la valeur de la plateforme si elle change.</span>
              </span>
            </button>

            <div
              role="radio"
              tabIndex={0}
              aria-checked={mode === 'custom'}
              onClick={() => setMode('custom')}
              onKeyDown={(event) => (event.key === ' ' || event.key === 'Enter') && setMode('custom')}
              className={cn(option(mode === 'custom'), 'cursor-pointer')}
            >
              <span className={radio(mode === 'custom')}>{mode === 'custom' && <span className="h-2 w-2 rounded-full bg-primary" />}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">Limite personnalisée</span>
                <span className="block text-xs text-muted-foreground">Une valeur propre à cette personne. 0 l’empêche de créer.</span>
                <span className="mt-3 block">
                  <Stepper
                    value={value}
                    label="Nombre de workspaces"
                    onChange={(next) => {
                      setMode('custom');
                      setValue(next);
                    }}
                  />
                </span>
              </span>
            </div>
          </div>

          {limit < user.createdCount ? (
            <Alert variant="warning">
              <AlertDescription className="flex gap-2">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Déjà {plural(user.createdCount, 'workspace')} créé{user.createdCount > 1 ? 's' : ''} : ils sont conservés, mais aucun nouveau ne pourra être
                  créé avant d’en supprimer ou d’en transférer.
                </span>
              </AlertDescription>
            </Alert>
          ) : (
            <p className="text-xs text-muted-foreground">
              {remaining === 0 ? (
                'Plus aucune création possible.'
              ) : (
                <>
                  Encore <span className="font-medium tabular-nums text-foreground">{remaining}</span> création{remaining > 1 ? 's' : ''} possible
                  {remaining > 1 ? 's' : ''}.
                </>
              )}
            </p>
          )}
          {!user.canCreateWorkspaces && (
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Hors du groupe d’accès Authentik : la limite s’appliquera une fois dans le groupe.
            </p>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving || unchanged}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Emails ----------------------------------------------------------------

function EmailsPanel() {
  const [templates, setTemplates] = useState<EmailTemplatePreview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [mailConfigured, setMailConfigured] = useState(true);

  useEffect(() => {
    api.admin
      .emailTemplates()
      .then((list) => {
        setTemplates(list);
        setSelected((current) => current ?? list[0]?.id ?? null);
      })
      .catch(() => setError('Impossible de charger les modèles d’email.'));
    api.admin
      .settings()
      .then((settings) => setMailConfigured(settings.mail.configured))
      .catch(() => undefined);
  }, []);

  const current = templates?.find((template) => template.id === selected) ?? null;

  const sendTest = async () => {
    if (!current) return;
    setSending(true);
    setNotice(null);
    try {
      const result = await api.admin.sendTestEmail(current.id);
      setNotice({ type: 'success', message: `« ${current.name} » envoyé à ${result.sentTo}, avec [Test] dans l’objet.` });
    } catch (err) {
      setNotice({ type: 'error', message: err instanceof ApiError ? err.message : 'Impossible d’envoyer cet email.' });
    } finally {
      setSending(false);
    }
  };

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!templates) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        Chargement des emails…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Tous les emails que Tarmac envoie, avec des données d’exemple. Ils reprennent le thème de l’application et s’adaptent aux téléphones.
        Envoyez-vous un test pour les voir dans votre propre messagerie.
      </p>
      {!mailConfigured && (
        <Alert variant="warning">
          <AlertDescription>L’envoi d’emails n’est pas configuré sur ce serveur : vous pouvez prévisualiser les modèles, mais aucun email ne part.</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Card className="h-fit overflow-hidden">
          <ul className="divide-y divide-border" role="listbox" aria-label="Modèles d’email">
            {templates.map((template) => {
              const active = template.id === selected;
              return (
                <li key={template.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      setSelected(template.id);
                      setNotice(null);
                    }}
                    className={cn('relative flex w-full items-start gap-3 px-4 py-3 text-left transition-colors', active ? 'bg-surface-2' : 'hover:bg-surface-2/60')}
                  >
                    {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" aria-hidden />}
                    <Mail className={cn('mt-0.5 h-4 w-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">{template.name}</span>
                      <span className="line-clamp-1 block text-2xs text-muted-foreground">{template.audience}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        {current && (
          <Card className="min-w-0 overflow-hidden">
            <div className="space-y-3 border-b border-border px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-foreground">{current.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{current.trigger}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Tabs value={device} onValueChange={(value) => setDevice(value as 'desktop' | 'mobile')}>
                    <TabsList variant="segmented">
                      <TabsTrigger value="desktop" aria-label="Aperçu ordinateur">
                        <Monitor className="h-3.5 w-3.5" />
                      </TabsTrigger>
                      <TabsTrigger value="mobile" aria-label="Aperçu téléphone">
                        <Smartphone className="h-3.5 w-3.5" />
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <Button size="sm" className="gap-1.5" onClick={() => void sendTest()} disabled={sending || !mailConfigured}>
                    {sending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    M’envoyer un test
                  </Button>
                </div>
              </div>
              <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[6rem_minmax(0,1fr)]">
                <dt className="text-muted-foreground">Objet</dt>
                <dd className="truncate font-medium text-foreground">{current.subject}</dd>
                <dt className="text-muted-foreground">Destinataires</dt>
                <dd className="text-foreground">{current.audience}</dd>
              </dl>
              {notice && (
                <Alert variant={notice.type === 'error' ? 'destructive' : 'success'}>
                  <AlertDescription>{notice.message}</AlertDescription>
                </Alert>
              )}
            </div>
            <div className="flex justify-center bg-[#0a0a0b] p-3 sm:p-6">
              <iframe
                key={`${current.id}-${device}`}
                title={`Aperçu : ${current.name}`}
                srcDoc={current.html}
                sandbox=""
                className={cn('h-[44rem] rounded-lg border border-border bg-[#0a0a0b] transition-all', device === 'mobile' ? 'w-[390px] max-w-full' : 'w-full')}
              />
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

// --- Settings --------------------------------------------------------------

function SettingsPanel() {
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api.admin
      .settings()
      .then((next) => {
        setSettings(next);
        setError(null);
      })
      .catch(() => setError('Impossible de charger les paramètres.'));

  useEffect(() => {
    void load();
  }, []);

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!settings) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        Chargement des paramètres…
      </div>
    );
  }

  return (
    <div className="grid max-w-3xl gap-4">
      <DefaultLimitCard settings={settings} onSaved={setSettings} />
      <AccessSyncCard settings={settings} onRefreshed={() => void load()} />
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted-foreground">
              <Mail className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Envoi d’emails</p>
              <p className="truncate text-xs text-muted-foreground">
                {settings.mail.configured ? `Les emails partent de ${settings.mail.from}.` : 'Non configuré sur ce serveur : aucun email ne part.'}
              </p>
            </div>
          </div>
          <Badge variant={settings.mail.configured ? 'success' : 'warning'}>{settings.mail.configured ? 'Actif' : 'Inactif'}</Badge>
        </CardContent>
      </Card>
    </div>
  );
}

function DefaultLimitCard({ settings, onSaved }: { settings: AdminSettings; onSaved: (next: AdminSettings) => void }) {
  const [value, setValue] = useState(settings.defaultWorkspaceLimit);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  useEffect(() => setValue(settings.defaultWorkspaceLimit), [settings.defaultWorkspaceLimit]);

  const save = async (next: number | null) => {
    setSaving(true);
    setNotice(null);
    try {
      const updated = await api.admin.updateSettings({ defaultWorkspaceLimit: next });
      onSaved(updated);
      setNotice({
        type: 'success',
        message: `Enregistré : chaque personne sans limite personnalisée peut maintenant créer ${plural(updated.defaultWorkspaceLimit, 'workspace')}.`,
      });
    } catch (err) {
      setNotice({ type: 'error', message: err instanceof ApiError ? err.message : 'Impossible d’enregistrer.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Gauge className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Limite de création par défaut</p>
            <p className="text-xs text-muted-foreground">
              Le nombre de workspaces que chaque personne peut posséder, sauf limite personnalisée. Les administrateurs ne sont pas limités.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-2 p-3">
          <Stepper value={value} onChange={setValue} label="Limite par défaut" />
          <span className="flex-1" />
          {settings.defaultWorkspaceLimitSource === 'admin' && (
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => void save(null)}>
              Revenir à {settings.environmentWorkspaceLimit}
            </Button>
          )}
          <Button size="sm" disabled={saving || value === settings.defaultWorkspaceLimit} onClick={() => void save(value)}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
        <p className="text-2xs text-muted-foreground">
          {settings.defaultWorkspaceLimitSource === 'admin'
            ? `Modifiée le ${formatDateTime(settings.defaultWorkspaceLimitUpdatedAt)}. Valeur d’installation : ${settings.environmentWorkspaceLimit}.`
            : 'Valeur d’installation du serveur, jamais modifiée ici.'}{' '}
          Les workspaces déjà créés sont toujours conservés.
        </p>
        {notice && (
          <Alert variant={notice.type === 'error' ? 'destructive' : 'success'}>
            <AlertDescription>{notice.message}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function AccessSyncCard({ settings, onRefreshed }: { settings: AdminSettings; onRefreshed: () => void }) {
  const sync = settings.accessSync;
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      await api.admin.runAccessSync();
      onRefreshed();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'La vérification a échoué.');
    } finally {
      setRunning(false);
    }
  };

  const state = !sync.configured ? 'off' : sync.ok === false ? 'error' : sync.lastRunAt ? 'ok' : 'pending';

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--info))]/10 text-[hsl(var(--info))]">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Vérification continue des accès</p>
              <p className="text-xs text-muted-foreground">
                Toutes les 5 minutes, Tarmac demande à Authentik qui fait encore partie du groupe d’accès, et déconnecte les autres sans attendre la fin
                de leur session.
              </p>
            </div>
          </div>
          <Badge variant={state === 'ok' ? 'success' : state === 'error' ? 'destructive' : state === 'off' ? 'secondary' : 'info'}>
            {state === 'ok' ? 'Active' : state === 'error' ? 'En erreur' : state === 'off' ? 'Non configurée' : 'En attente'}
          </Badge>
        </div>

        {state === 'off' ? (
          <div className="space-y-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Pour l’activer</p>
            <ol className="list-decimal space-y-1 pl-4">
              <li>Dans Authentik, créez un compte de service avec le droit de lire les utilisateurs et les groupes.</li>
              <li>Générez-lui un jeton d’API.</li>
              <li>Ajoutez ce jeton à la configuration du serveur Tarmac puis redéployez.</li>
            </ol>
            <p>En attendant, l’appartenance au groupe est vérifiée à chaque connexion.</p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-2 p-3 text-xs">
            <span className="text-muted-foreground">
              {sync.lastRunAt ? (
                <>
                  Dernière vérification <span className="text-foreground">{formatRelative(sync.lastRunAt)}</span>
                  {sync.ok !== false && ` · ${plural(sync.checked, 'compte')} contrôlé${sync.checked > 1 ? 's' : ''}`}
                </>
              ) : (
                'Première vérification dans les prochaines minutes.'
              )}
            </span>
            <span className="flex-1" />
            <Button variant="secondary" size="sm" className="gap-1.5" disabled={running} onClick={() => void run()}>
              <RefreshCw className={cn('h-3.5 w-3.5', running && 'animate-spin')} />
              Vérifier maintenant
            </Button>
          </div>
        )}

        {sync.ok === false && sync.message && (
          <Alert variant="destructive">
            <AlertDescription>
              La dernière vérification n’a rien changé, par sécurité : {sync.message}.
            </AlertDescription>
          </Alert>
        )}
        {sync.revoked.length > 0 && (
          <Alert variant="warning">
            <AlertDescription>Accès retiré lors de la dernière vérification : {sync.revoked.join(', ')}.</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
