'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Building2,
  Gauge,
  Info,
  LoaderCircle,
  LogOut,
  Minus,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
  UserCheck,
  Users,
} from 'lucide-react';
import { AdminUser, api, ApiError } from '../../lib/api';
import { usePolling } from '../../lib/hooks/usePolling';
import { cn } from '../../lib/utils';
import { BrandMark } from '../../components/BrandMark';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Stat, StatRow } from '../../components/ui/stat';
import { Tabs, TabsCount, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip';

type Filter = 'all' | 'access' | 'none' | 'full';

const MAX_LIMIT = 100;

const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? 's' : ''}`;

const initials = (user: AdminUser) =>
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

function Avatar({ user, size = 'md' }: { user: AdminUser; size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-11 w-11 text-sm' : 'h-9 w-9 text-xs';
  if (user.avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={user.avatarUrl} alt="" className={cn('shrink-0 rounded-full object-cover', box)} />;
  }
  return (
    <span className={cn('flex shrink-0 items-center justify-center rounded-full font-semibold', box, avatarTone(user.id))}>{initials(user)}</span>
  );
}

const isFull = (user: AdminUser) => !user.isSuperuser && user.canCreateWorkspaces && user.createdCount >= user.effectiveLimit;

export default function AdminPage() {
  const router = useRouter();
  const { data: profile } = usePolling('profile', api.profile.get, { intervalMs: 60000 });
  const isSuperuser = profile?.isSuperuser ?? false;
  const { data, error, isLoading, mutate } = usePolling(isSuperuser ? 'admin:users' : null, api.admin.listUsers, { intervalMs: 30000 });

  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The API refuses anyone else anyway; this only keeps them off a page
  // that would stay empty.
  useEffect(() => {
    if (profile && !profile.isSuperuser) router.replace('/workspaces');
  }, [profile, router]);

  const users = useMemo(() => data?.users ?? [], [data]);
  const counts = useMemo(
    () => ({
      all: users.length,
      access: users.filter((user) => user.canCreateWorkspaces || user.isSuperuser).length,
      none: users.filter((user) => !user.canCreateWorkspaces && !user.isSuperuser).length,
      full: users.filter(isFull).length,
    }),
    [users],
  );
  const created = users.reduce((sum, user) => sum + user.createdCount, 0);

  const needle = query.trim().toLowerCase();
  const shown = users.filter((user) => {
    if (filter === 'access' && !(user.canCreateWorkspaces || user.isSuperuser)) return false;
    if (filter === 'none' && (user.canCreateWorkspaces || user.isSuperuser)) return false;
    if (filter === 'full' && !isFull(user)) return false;
    return !needle || user.email.toLowerCase().includes(needle) || (user.name ?? '').toLowerCase().includes(needle);
  });

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
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-4">
            <span className="flex items-center gap-2">
              <BrandMark />
              <span className="text-sm font-semibold tracking-tight text-foreground">Tarmac</span>
              <span className="text-sm text-muted-foreground/50">/</span>
              <span className="text-sm text-muted-foreground">Administration</span>
            </span>
            <Button variant="ghost" size="sm" onClick={() => void handleLogout()} className="gap-2">
              <LogOut className="h-4 w-4" />
              Déconnexion
            </Button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-6 py-10">
          <div>
            <Link
              href="/workspaces"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Mes workspaces
            </Link>
            <h1 className="mt-3 flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Administration de la plateforme
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Les comptes qui se sont déjà connectés à Tarmac, et combien de workspaces chacun peut créer. Seuls les administrateurs Authentik voient
              cette page.
            </p>
          </div>

          <StatRow>
            <Stat label="Utilisateurs" value={data ? counts.all : '—'} icon={Users} hint="connectés au moins une fois" />
            <Stat label="Accès Tarmac" value={data ? counts.access : '—'} icon={UserCheck} tone="ok" hint="groupe d’accès ou admin" />
            <Stat label="Workspaces créés" value={data ? created : '—'} icon={Building2} hint="par les utilisateurs listés" />
            <Stat
              label="Limite par défaut"
              value={data ? data.defaultLimit : '—'}
              unit="par personne"
              icon={Gauge}
              tone="info"
              hint="WORKSPACE_CREATION_LIMIT"
            />
          </StatRow>

          <div className="flex flex-wrap items-center gap-3">
            <Tabs
              value={filter}
              onValueChange={(value) => setFilter(value as Filter)}
              className="-mx-6 w-[calc(100%+3rem)] overflow-x-auto px-6 [scrollbar-width:none] sm:mx-0 sm:w-auto sm:px-0 [&::-webkit-scrollbar]:hidden"
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
              </TabsList>
            </Tabs>
            <span className="flex-1" />
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Rechercher par nom ou e-mail…"
                className="h-8 pl-8"
              />
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
            {(isLoading || !profile) && !data ? (
              <div className="flex items-center gap-2 px-4 py-10 text-sm text-muted-foreground">
                <LoaderCircle className="h-4 w-4 animate-spin" />
                Chargement des utilisateurs…
              </div>
            ) : shown.length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-muted-foreground">Aucun utilisateur ne correspond.</p>
            ) : (
              <ul className="divide-y divide-border">
                {shown.map((user) => (
                  <UserRow key={user.id} user={user} isSelf={user.id === profile?.id} onEdit={() => setEditing(user)} />
                ))}
              </ul>
            )}
          </Card>

          <p className="flex items-start gap-2 text-2xs leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            L’accès à Tarmac se gère dans Authentik (groupe d’accès) et est relu à chaque connexion. Seuls comptent les workspaces qu’une personne a
            elle-même créés : ceux où elle est invitée n’entrent pas dans sa limite, et en supprimer un libère une place.
          </p>
        </main>

        {data && (
          <LimitDialog
            user={editing}
            defaultLimit={data.defaultLimit}
            onClose={() => setEditing(null)}
            onSaved={(message) => {
              setEditing(null);
              setNotice(message);
              void mutate();
            }}
          />
        )}
      </div>
    </TooltipProvider>
  );
}

function UserRow({ user, isSelf, onEdit }: { user: AdminUser; isSelf: boolean; onEdit: () => void }) {
  const full = isFull(user);
  const percent = user.effectiveLimit > 0 ? Math.min(100, (user.createdCount / user.effectiveLimit) * 100) : 100;

  return (
    <li className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3.5 sm:flex-nowrap">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar user={user} />
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
            <span className="truncate">{user.name || user.email}</span>
            {isSelf && <span className="shrink-0 rounded bg-surface-3 px-1.5 py-px text-2xs font-normal text-muted-foreground">vous</span>}
          </p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
      </div>

      <div className="flex w-full items-center gap-3 pl-12 sm:w-auto sm:gap-6 sm:pl-0">
        <div className="hidden w-28 shrink-0 md:block">
          {user.isSuperuser ? (
            <Badge variant="info">
              <ShieldCheck className="h-3 w-3" />
              Administrateur
            </Badge>
          ) : user.canCreateWorkspaces ? (
            <Badge variant="success">Accès Tarmac</Badge>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Badge variant="secondary">Sans accès</Badge>
                </span>
              </TooltipTrigger>
              <TooltipContent>Pas dans le groupe d’accès Authentik à sa dernière connexion</TooltipContent>
            </Tooltip>
          )}
        </div>

        <div className="w-36 shrink-0 sm:w-40">
          {user.isSuperuser ? (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground tabular-nums">{user.createdCount}</span> créé{user.createdCount > 1 ? 's' : ''} · sans
              limite
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
                <div
                  className={cn('h-full rounded-full transition-all', full ? 'bg-[hsl(var(--warn))]' : 'bg-primary')}
                  style={{ width: `${percent}%` }}
                />
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
            Modifier
          </Button>
        )}
      </div>
    </li>
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
  const clamp = (next: number) => setValue(Math.max(0, Math.min(MAX_LIMIT, Number.isFinite(next) ? next : 0)));

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
    cn(
      'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
      selected ? 'border-primary/60 bg-primary/5' : 'border-border hover:bg-surface-2',
    );
  const radio = (selected: boolean) =>
    cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', selected ? 'border-primary' : 'border-muted-foreground/40');

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Limite de création</DialogTitle>
          <DialogDescription>Combien de workspaces cette personne peut créer elle-même.</DialogDescription>
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
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'default'}
              onClick={() => setMode('default')}
              className={option(mode === 'default')}
            >
              <span className={radio(mode === 'default')}>{mode === 'default' && <span className="h-2 w-2 rounded-full bg-primary" />}</span>
              <span>
                <span className="block text-sm font-medium text-foreground">Limite par défaut</span>
                <span className="block text-xs text-muted-foreground">
                  {plural(defaultLimit, 'workspace')}, et suit la valeur de la plateforme si elle change.
                </span>
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
                <span className="mt-3 flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    aria-label="Diminuer"
                    className="h-8 w-8 p-0"
                    disabled={value <= 0}
                    onClick={(event) => {
                      event.stopPropagation();
                      setMode('custom');
                      clamp(value - 1);
                    }}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={MAX_LIMIT}
                    value={value}
                    aria-label="Nombre de workspaces"
                    onFocus={() => setMode('custom')}
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
                    disabled={value >= MAX_LIMIT}
                    onClick={(event) => {
                      event.stopPropagation();
                      setMode('custom');
                      clamp(value + 1);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                  <span className="text-xs text-muted-foreground">workspace{value > 1 ? 's' : ''}</span>
                </span>
              </span>
            </div>
          </div>

          {limit < user.createdCount ? (
            <Alert variant="warning">
              <AlertDescription className="flex gap-2">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Déjà {plural(user.createdCount, 'workspace')} créé{user.createdCount > 1 ? 's' : ''} : ils sont conservés, mais aucun nouveau ne
                  pourra être créé avant d’en supprimer.
                </span>
              </AlertDescription>
            </Alert>
          ) : (
            <p className="text-xs text-muted-foreground">
              {remaining === 0 ? (
                'Plus aucune création possible.'
              ) : (
                <>
                  Encore <span className="font-medium text-foreground tabular-nums">{remaining}</span> création{remaining > 1 ? 's' : ''} possible
                  {remaining > 1 ? 's' : ''}.
                </>
              )}
            </p>
          )}
          {!user.canCreateWorkspaces && (
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Hors du groupe d’accès Authentik à sa dernière connexion : la limite s’appliquera une fois dans le groupe.
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
