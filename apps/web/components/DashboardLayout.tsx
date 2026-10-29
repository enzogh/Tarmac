'use client';

import Link from 'next/link';
import { usePathname, useParams, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { LogOut, BookOpen, ChevronDown, Eye, Lock, Search, Menu, ShieldAlert, X } from 'lucide-react';
import { api } from '../lib/api';
import { buildNavGroups, buildNavItems, NavItem, navItemArea, visibleNavGroups } from '../lib/nav-items';
import { areaOfPath, isRestrictedToRead, useWorkspaceAccess } from '../lib/access';
import { ReadOnlyProvider } from '../lib/read-only';
import { BrandMark } from './BrandMark';
import { CommandPalette } from './CommandPalette';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { useWorkspace, WorkspaceProvider } from '../lib/workspace-context';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { cn } from '../lib/utils';

export function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <WorkspaceProvider>
      <DashboardLayoutInner>{children}</DashboardLayoutInner>
    </WorkspaceProvider>
  );
}

const NAV_GROUP_COLLAPSE_KEY_PREFIX = 'tarmac.navGroupCollapsed.';

function DashboardLayoutInner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useParams<{ workspace: string }>();
  const slug = params.workspace;
  const access = useWorkspaceAccess();
  // Cheap enough to rebuild every render, and follows role changes as soon
  // as the workspaces poll brings them in.
  const navGroups = visibleNavGroups(buildNavGroups(slug), (item) => {
    const area = navItemArea(item);
    return !area || access.level(area) !== 'none';
  });
  const navItems = useMemo(() => buildNavItems(slug), [slug]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Starts empty (all groups expanded) so server and first client render
  // match, then hydrates from localStorage right after mount - a group's
  // collapsed state is a per-user UI preference, not something that should
  // ever flash or cause a hydration mismatch.
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    const initial: Record<string, boolean> = {};
    for (const group of navGroups) {
      if (!group.label) continue;
      initial[group.label] = localStorage.getItem(`${NAV_GROUP_COLLAPSE_KEY_PREFIX}${group.label}`) === '1';
    }
    setCollapsedGroups(initial);
    // navGroups is recomputed per-slug but its group labels are static -
    // only needs to run once, not on every slug change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleGroup = (label: string) => {
    setCollapsedGroups((prev) => {
      const collapsed = !prev[label];
      localStorage.setItem(`${NAV_GROUP_COLLAPSE_KEY_PREFIX}${label}`, collapsed ? '1' : '0');
      return { ...prev, [label]: collapsed };
    });
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } finally {
      router.push('/login');
    }
  };

  const isNavItemActive = (item: NavItem) =>
    item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + '/');

  const renderNavLink = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = isNavItemActive(item);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          'relative flex items-center gap-2.5 rounded-md py-1.5 pl-3 pr-2 text-sm transition-colors',
          isActive
            ? 'bg-surface-2 font-medium text-foreground'
            : 'text-muted-foreground hover:bg-surface-2/60 hover:text-foreground',
        )}
      >
        {isActive && <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary" aria-hidden />}
        <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-primary' : 'text-muted-foreground/70')} />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {(() => {
          const area = navItemArea(item);
          return area && isRestrictedToRead(area, access.level(area)) ? (
            <Eye className="h-3 w-3 shrink-0 text-muted-foreground/60" aria-label="Lecture seule" />
          ) : null;
        })()}
      </Link>
    );
  };

  return (
    <TooltipProvider delayDuration={300}>
      <CommandPalette />
      {/* The shell is locked to the viewport and only <main> scrolls. It
          used to be `min-h-screen` with the document itself scrolling, and
          the sidebar's `lg:sticky` never engaged because an ancestor
          carried `overflow-hidden` - so on any page taller than the window
          (network, infrastructure, the DNS console) the navigation simply
          scrolled away off the top. */}
      <div className="relative flex h-screen overflow-hidden">
        {/* Mobile backdrop */}
        {mobileNavOpen && (
          <div
            className="fixed inset-0 z-20 bg-black/60 backdrop-blur-sm lg:hidden"
            onClick={() => setMobileNavOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-30 flex w-60 shrink-0 flex-col border-r border-border bg-surface-1 transition-transform duration-200 lg:static lg:z-10 lg:h-full lg:translate-x-0',
            mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          {/* Logo - compact, since WorkspaceSwitcher right below now carries
              the "which workspace am I in" identity that used to sit here as
              a generic "Storage dashboard" subtitle. */}
          <div className="border-b border-border px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <BrandMark />
                <h1 className="text-sm font-semibold tracking-tight text-foreground">Tarmac</h1>
              </div>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground lg:hidden"
                aria-label="Fermer le menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <WorkspaceSwitcher />
          </div>

          {/* Navigation - min-h-0 lets this shrink below its content's
              intrinsic height inside the flex column so overflow-y-auto
              actually activates internal scrolling, instead of growing the
              whole <aside> (and pushing the footer below the fold). */}
          <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
            {navGroups.map((group, groupIndex) => {
              if (!group.label) {
                return (
                  <div key={`group-${groupIndex}`} className="space-y-0.5 pb-2">
                    {group.items.map(renderNavLink)}
                  </div>
                );
              }
              const isCollapsed = collapsedGroups[group.label];
              const GroupIcon = group.icon;
              const groupIsActive = group.items.some(isNavItemActive);
              return (
                <div
                  key={group.label}
                  className={cn(
                    'space-y-0.5 border-t border-border pt-2',
                    groupIsActive && isCollapsed && 'rounded-md bg-surface-2/50',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.label as string)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-md px-3 py-1 text-2xs font-semibold uppercase tracking-wider transition-colors',
                      groupIsActive ? 'text-foreground/70' : 'text-muted-foreground/60 hover:text-muted-foreground',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {GroupIcon && <GroupIcon className="h-3 w-3" />}
                      {group.label}
                    </span>
                    <ChevronDown className={cn('h-3 w-3 transition-transform', isCollapsed && '-rotate-90')} />
                  </button>
                  {!isCollapsed && group.items.map(renderNavLink)}
                </div>
              );
            })}
          </nav>

          {/* Footer - shrink-0 keeps it at its natural height even though
              <aside> is now locked to viewport height (lg:h-screen above),
              so Documentation/Déconnexion are always visible without
              scrolling, no matter how many nav items exist. */}
          <div className="shrink-0 space-y-0.5 border-t border-border p-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href="/docs"
                  className="flex items-center gap-2.5 rounded-md py-1.5 pl-3 pr-2 text-sm text-muted-foreground transition-colors hover:bg-surface-2/60 hover:text-foreground"
                >
                  <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                  Documentation
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">Guide d'utilisation et référence API</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  onClick={handleLogout}
                  className="h-auto w-full justify-start gap-2.5 py-1.5 pl-3 pr-2 font-normal text-muted-foreground hover:text-foreground"
                >
                  <LogOut className="h-4 w-4" />
                  Déconnexion
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Se déconnecter du tableau de bord</TooltipContent>
            </Tooltip>
          </div>
        </aside>

        {/* Main Content */}
        <div className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Top Bar */}
          <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface-1 px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                className="-ml-1 rounded-md p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground lg:hidden"
                aria-label="Ouvrir le menu"
              >
                <Menu className="h-5 w-5" />
              </button>
              {/* The breadcrumb is the only thing in this bar that tells you
                  where you are, so it gets the full width it needs; the
                  decorative "live" dot and the current date that used to sit
                  here said nothing a monitoring console doesn't already show
                  on the page itself. */}
              <nav aria-label="Fil d'Ariane" className="flex min-w-0 items-center gap-1.5 text-sm">
                <Link href="/workspaces" className="shrink-0 text-muted-foreground transition-colors hover:text-foreground">
                  Tarmac
                </Link>
                <span className="shrink-0 text-muted-foreground/40">/</span>
                <span className="truncate font-medium text-foreground">
                  {navItems.find(isNavItemActive)?.label ?? 'Tableau de bord'}
                </span>
              </nav>
            </div>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('tarmac:open-command-palette'))}
              className="flex shrink-0 items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground"
            >
              <Search className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Rechercher</span>
              <kbd className="rounded border border-border bg-surface-3 px-1.5 py-px font-mono text-[10px]">⌘K</kbd>
            </button>
          </header>

          {/* Content */}
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
              <NoWorkspaceAccessGate>
                <div key={pathname} className="animate-page-in motion-reduce:animate-none">
                  <PageAccessGate pathname={pathname}>{children}</PageAccessGate>
                </div>
              </NoWorkspaceAccessGate>
            </div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}

const AREA_LABEL: Record<string, string> = {
  nodes: 'Nœuds',
  network: 'Réseau privé',
  dns: 'DNS',
  vpn: 'VPN',
  storage: 'Stockage',
  alerts: 'Alertes',
  logs: 'Journal',
  manage: 'Administration',
};

// The member's role, applied to the page itself: no access is a clear
// explanation instead of a page of failed requests, read-only is said up
// front instead of discovered on the first refused click.
function PageAccessGate({ pathname, children }: { pathname: string; children: ReactNode }) {
  const access = useWorkspaceAccess();
  const area = areaOfPath(pathname);
  if (!area || !access.ready) return <>{children}</>;
  const level = access.level(area);

  if (level === 'none') {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-xl border border-border bg-surface-1 px-6 py-16 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2">
          <Lock className="h-5 w-5 text-muted-foreground" />
        </span>
        <h2 className="text-base font-semibold text-foreground">Accès restreint</h2>
        <p className="text-sm text-muted-foreground">
          {area === 'manage'
            ? 'Cette page est réservée aux administrateurs du workspace.'
            : `Votre rôle ne donne pas accès à « ${AREA_LABEL[area]} » dans ce workspace.`}{' '}
          Un administrateur peut changer vos droits dans Paramètres → Membres.
        </p>
      </div>
    );
  }

  const readOnly = isRestrictedToRead(area, level);
  return (
    <ReadOnlyProvider readOnly={readOnly} area={AREA_LABEL[area]}>
      {readOnly && (
        <div className="mb-4 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-[hsl(var(--info))]/25 bg-[hsl(var(--info))]/[0.07] px-3.5 py-2 text-xs text-foreground/90">
          <Eye className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--info))]" />
          <span>
            <span className="font-medium">Lecture seule.</span> Votre rôle permet de consulter « {AREA_LABEL[area]} » sans rien y modifier.
          </span>
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            Les actions marquées <Lock className="h-3 w-3" /> vous sont fermées.
          </span>
        </div>
      )}
      {children}
    </ReadOnlyProvider>
  );
}

// Shouldn't normally be reachable - the SSO callback already rejects a login
// with no workspace membership and no platform-admin claim (see
// sso.controller.ts) - but a membership can be revoked while a session's JWT
// (valid up to 12h) is still live, so every page falls back to this instead
// of a blank screen full of failed API calls.
function NoWorkspaceAccessGate({ children }: { children: ReactNode }) {
  const { workspaces, isPlatformAdmin, isLoading } = useWorkspace();

  if (!isLoading && !isPlatformAdmin && workspaces.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-16 text-center">
        <ShieldAlert className="h-8 w-8 text-amber-400" />
        <h2 className="text-base font-semibold text-foreground">Aucun accès workspace</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Votre compte n&apos;est actuellement rattaché à aucun workspace. Contactez un administrateur pour qu&apos;il
          vous y ajoute.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
