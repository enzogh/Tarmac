'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { usePathname, useParams } from 'next/navigation';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Bell, BookOpen, ChevronDown, ChevronRight, Eye, Lock, Search, Menu, ShieldAlert, X } from 'lucide-react';
import { api } from '../lib/api';
import { buildNavGroups, NavGroup, NavItem, navItemArea, visibleNavGroups } from '../lib/nav-items';
import { areaOfPath, isRestrictedToRead, useWorkspaceAccess } from '../lib/access';
import { usePolling } from '../lib/hooks/usePolling';
import { ReadOnlyProvider } from '../lib/read-only';
import { BrandMark } from './BrandMark';
import { CommandPalette } from './CommandPalette';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { useWorkspace, WorkspaceProvider } from '../lib/workspace-context';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { UserMenu } from './UserMenu';
import { cn } from '../lib/utils';

export function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <WorkspaceProvider>
      <DashboardLayoutInner>{children}</DashboardLayoutInner>
    </WorkspaceProvider>
  );
}

const NAV_GROUP_COLLAPSE_KEY_PREFIX = 'tarmac.navGroupCollapsed.';

// Open alerts, counted the way the overview and the alerts page count them
// (one per distinct message), for the badge on the bell and the menu entry.
function useOpenAlertCount(enabled: boolean): number {
  const { data: alerts } = usePolling(enabled ? 'alerts' : null, api.alerts.list, { intervalMs: 30000, redirectOnError: false });
  return useMemo(() => new Set((alerts ?? []).filter((alert) => alert.status !== 'resolved').map((alert) => alert.message)).size, [alerts]);
}

function CountBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        'tabular inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[hsl(var(--danger))] px-1 text-[10px] font-semibold leading-none text-white shadow-[0_0_0_2px_hsl(var(--surface-1))]',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

function DashboardLayoutInner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const params = useParams<{ workspace: string }>();
  const slug = params.workspace;
  const access = useWorkspaceAccess();
  const { currentWorkspace } = useWorkspace();
  // Cheap enough to rebuild every render, and follows role changes as soon
  // as the workspaces poll brings them in.
  const navGroups = visibleNavGroups(buildNavGroups(slug), (item) => {
    const area = navItemArea(item);
    return !area || access.level(area) !== 'none';
  });
  const allGroups = useMemo(() => buildNavGroups(slug), [slug]);
  const canSeeAlerts = access.ready && access.level('alerts') !== 'none';
  const openAlerts = useOpenAlertCount(canSeeAlerts);
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
      try {
        initial[group.label] = localStorage.getItem(`${NAV_GROUP_COLLAPSE_KEY_PREFIX}${group.label}`) === '1';
      } catch {
        // Storage blocked: every group stays open.
      }
    }
    setCollapsedGroups(initial);
    // navGroups is recomputed per-slug but its group labels are static -
    // only needs to run once, not on every slug change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleGroup = (label: string) => {
    setCollapsedGroups((prev) => {
      const collapsed = !prev[label];
      try {
        localStorage.setItem(`${NAV_GROUP_COLLAPSE_KEY_PREFIX}${label}`, collapsed ? '1' : '0');
      } catch {
        // Not remembered, still applied.
      }
      return { ...prev, [label]: collapsed };
    });
  };

  const isNavItemActive = (item: NavItem) =>
    item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + '/');

  // Where am I: the group and the page, for the breadcrumb.
  const activeGroup: NavGroup | undefined = allGroups.find((group) => group.items.some(isNavItemActive));
  const activeItem = activeGroup?.items.find(isNavItemActive);
  const alertsHref = `/${slug}/dashboard/alerts`;

  const renderNavLink = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = isNavItemActive(item);
    const area = navItemArea(item);
    const readOnly = area ? isRestrictedToRead(area, access.level(area)) : false;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          'group/link relative flex h-8 items-center gap-2.5 rounded-lg pl-2.5 pr-2 text-[13px] transition-colors duration-150',
          isActive ? 'font-medium text-foreground' : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground',
        )}
      >
        {isActive && (
          <motion.span
            layoutId="nav-active"
            className="absolute inset-0 rounded-lg bg-gradient-to-r from-primary/[0.16] to-primary/[0.04] shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.18)]"
            transition={{ type: 'spring', stiffness: 520, damping: 40, mass: 0.8 }}
            aria-hidden
          />
        )}
        <Icon
          className={cn(
            'relative h-4 w-4 shrink-0 transition-colors',
            isActive ? 'text-primary' : 'text-muted-foreground/60 group-hover/link:text-muted-foreground',
          )}
        />
        <span className="relative min-w-0 flex-1 truncate">{item.label}</span>
        {item.href === alertsHref && <CountBadge count={openAlerts} className="relative shadow-none" />}
        {readOnly && <Eye className="relative h-3 w-3 shrink-0 text-muted-foreground/60" aria-label="Lecture seule" />}
      </Link>
    );
  };

  return (
    <TooltipProvider delayDuration={300}>
      <CommandPalette />
      {/* The shell is locked to the viewport and only <main> scrolls, so the
          navigation never scrolls away on long pages. */}
      <div className="relative flex h-[100dvh] overflow-hidden">
        {/* Mobile backdrop */}
        <div
          className={cn(
            'fixed inset-0 z-20 bg-black/60 backdrop-blur-sm transition-opacity duration-300 lg:hidden',
            mobileNavOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
          onClick={() => setMobileNavOpen(false)}
          aria-hidden
        />

        {/* Sidebar */}
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-30 flex w-[248px] shrink-0 flex-col border-r border-white/[0.06] bg-surface-1/85 backdrop-blur-xl backdrop-saturate-150 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] lg:static lg:z-10 lg:h-full lg:translate-x-0 lg:bg-surface-1/60',
            mobileNavOpen ? 'translate-x-0 shadow-overlay' : '-translate-x-full',
          )}
        >
          <div className="space-y-3 px-3 pb-3 pt-3.5">
            <div className="flex items-center justify-between gap-3 px-1">
              <Link href="/workspaces" className="flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <BrandMark />
                <span className="text-[15px] font-semibold tracking-tight text-foreground">Tarmac</span>
              </Link>
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

          {/* min-h-0 lets the list shrink inside the flex column so it
              scrolls on its own, keeping the account menu in view. */}
          <nav className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-6 [mask-image:linear-gradient(to_bottom,black_calc(100%-28px),transparent)]" aria-label="Navigation principale">
            {navGroups.map((group, groupIndex) => {
              if (!group.label) {
                return (
                  <div key={`group-${groupIndex}`} className="space-y-px">
                    {group.items.map(renderNavLink)}
                  </div>
                );
              }
              const isCollapsed = collapsedGroups[group.label];
              const groupIsActive = group.items.some(isNavItemActive);
              return (
                <div key={group.label} className="mt-3.5">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.label as string)}
                    aria-expanded={!isCollapsed}
                    className={cn(
                      'group/head mb-0.5 flex h-6 w-full items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium tracking-wide transition-colors',
                      groupIsActive ? 'text-foreground/80' : 'text-muted-foreground/70 hover:text-muted-foreground',
                    )}
                  >
                    <span className="flex-1 text-left">{group.label}</span>
                    {isCollapsed && groupIsActive && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />}
                    <ChevronDown
                      className={cn(
                        'h-3 w-3 opacity-0 transition-[transform,opacity] group-hover/head:opacity-100 group-focus-visible/head:opacity-100',
                        isCollapsed && '-rotate-90 opacity-100',
                      )}
                    />
                  </button>
                  {!isCollapsed && <div className="space-y-px">{group.items.map(renderNavLink)}</div>}
                </div>
              );
            })}
          </nav>

          <div className="shrink-0 border-t border-white/[0.06] p-2">
            <UserMenu slug={slug} />
          </div>
        </aside>

        {/* Main Content */}
        <div className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Top Bar */}
          <header className="relative z-10 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] bg-background/60 px-4 backdrop-blur-xl backdrop-saturate-150 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                className="-ml-1 rounded-md p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground lg:hidden"
                aria-label="Ouvrir le menu"
              >
                <Menu className="h-5 w-5" />
              </button>
              <nav aria-label="Fil d'Ariane" className="flex min-w-0 items-center gap-1.5 text-sm">
                <Link
                  href={`/${slug}/dashboard`}
                  className="hidden shrink-0 truncate text-muted-foreground transition-colors hover:text-foreground sm:block sm:max-w-[12rem]"
                >
                  {currentWorkspace?.name ?? 'Workspace'}
                </Link>
                {activeGroup?.label && (
                  <>
                    <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground/40 sm:block" />
                    <span className="hidden shrink-0 text-muted-foreground md:block">{activeGroup.label}</span>
                  </>
                )}
                <ChevronRight className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground/40 sm:block" />
                <span className="truncate font-medium text-foreground">{activeItem?.label ?? 'Tableau de bord'}</span>
              </nav>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('tarmac:open-command-palette'))}
                className="flex h-9 items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 text-sm text-muted-foreground transition-colors hover:border-white/[0.12] hover:bg-white/[0.05] hover:text-foreground lg:w-72"
                aria-label="Rechercher"
              >
                <Search className="h-4 w-4 shrink-0" />
                <span className="hidden flex-1 text-left sm:inline">Rechercher…</span>
                <kbd className="hidden rounded-md border border-white/[0.08] bg-surface-2 px-1.5 py-px font-sans text-[10px] font-medium text-muted-foreground sm:inline">
                  ⌘ K
                </kbd>
              </button>
              {canSeeAlerts && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href={alertsHref}
                      className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground"
                      aria-label={openAlerts > 0 ? `${openAlerts} alerte(s) à traiter` : 'Alertes'}
                    >
                      <Bell className="h-[18px] w-[18px]" />
                      <CountBadge count={openAlerts} className="absolute -right-0.5 -top-0.5 shadow-[0_0_0_2px_hsl(var(--background))]" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent>{openAlerts > 0 ? `${openAlerts} alerte${openAlerts > 1 ? 's' : ''} à traiter` : 'Aucune alerte en cours'}</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href="/docs"
                    className="hidden h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground sm:flex"
                    aria-label="Documentation"
                  >
                    <BookOpen className="h-[18px] w-[18px]" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent>Guide d&apos;utilisation</TooltipContent>
              </Tooltip>
            </div>
          </header>

          {/* Content */}
          <main className="relative flex-1 overflow-y-auto">
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_70%_60%_at_50%_-10%,hsl(var(--primary)/0.09),transparent_70%)]"
              aria-hidden
            />
            <div className="relative mx-auto max-w-[1600px] px-4 pb-16 pt-7 sm:px-6 lg:px-10">
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
