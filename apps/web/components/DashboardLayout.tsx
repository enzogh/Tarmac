'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { LogOut, Layers, BookOpen, ChevronDown, Search, Menu, ShieldAlert, X } from 'lucide-react';
import { api } from '../lib/api';
import { NAV_GROUPS, NAV_ITEMS, NavItem } from '../lib/nav-items';
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
    for (const group of NAV_GROUPS) {
      if (!group.label) continue;
      initial[group.label] = localStorage.getItem(`${NAV_GROUP_COLLAPSE_KEY_PREFIX}${group.label}`) === '1';
    }
    setCollapsedGroups(initial);
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

  const renderNavLink = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = item.exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(item.href + '/');
    return (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150',
          isActive
            ? 'bg-violet-600/15 text-violet-300 shadow-[inset_0_0_0_1px_rgba(139,92,246,0.2)]'
            : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100'
        )}
      >
        <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-violet-400' : 'text-zinc-500')} />
        {item.label}
      </Link>
    );
  };

  return (
    <TooltipProvider delayDuration={300}>
      <CommandPalette />
      <div className="relative flex min-h-screen overflow-hidden">
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
            'fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-white/[0.06] bg-zinc-950/95 backdrop-blur-2xl transition-transform duration-200 lg:sticky lg:top-0 lg:z-10 lg:h-screen lg:translate-x-0 lg:self-start lg:bg-zinc-950/80',
            mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          {/* Logo */}
          <div className="border-b border-white/[0.06] px-5 py-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 shadow-glow">
                  <Layers className="h-4 w-4 text-white" />
                </div>
                <div>
                  <h1 className="text-base font-semibold tracking-tight text-foreground">Tarmac</h1>
                  <p className="text-[11px] text-muted-foreground">Storage dashboard</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100 lg:hidden"
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
          <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4">
            {NAV_GROUPS.map((group, groupIndex) => {
              if (!group.label) {
                return (
                  <div key={`group-${groupIndex}`} className="space-y-0.5">
                    {group.items.map(renderNavLink)}
                  </div>
                );
              }
              const isCollapsed = collapsedGroups[group.label];
              return (
                <div key={group.label} className="space-y-0.5">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.label as string)}
                    className="flex w-full items-center justify-between rounded-lg px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-600 transition-colors hover:text-zinc-400"
                  >
                    {group.label}
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
          <div className="shrink-0 space-y-1 border-t border-white/[0.06] p-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href="/docs"
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-zinc-100"
                >
                  <BookOpen className="h-4 w-4 shrink-0 text-zinc-500" />
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
                  className="w-full justify-start gap-3 text-zinc-400 hover:text-zinc-100"
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
        <div className="relative z-10 flex flex-1 flex-col overflow-hidden">
          {/* Top Bar */}
          <header className="flex items-center justify-between gap-2 border-b border-white/[0.06] bg-zinc-950/60 px-4 py-3.5 backdrop-blur-xl sm:px-6">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                className="-ml-1 mr-1 rounded-lg p-1.5 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100 lg:hidden"
                aria-label="Ouvrir le menu"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
              <span className="hidden text-sm font-medium text-foreground sm:inline">Tarmac</span>
              <span className="hidden text-sm text-zinc-600 sm:inline">/</span>
              <span className="truncate text-sm text-muted-foreground">
                {NAV_ITEMS.find(
                  (n) =>
                    n.exact
                      ? pathname === n.href
                      : pathname === n.href || pathname.startsWith(n.href + '/')
                )?.label ?? 'Dashboard'}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="hidden items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-xs text-muted-foreground sm:flex">
                <Search className="h-3 w-3" />
                <span>Rechercher</span>
                <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
              </div>
              <div className="hidden rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-xs text-muted-foreground sm:block">
                {new Date().toLocaleDateString('fr-FR', {
                  weekday: 'short',
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </div>
            </div>
          </header>

          {/* Content */}
          <main className="flex-1 overflow-auto">
            <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
              <NoWorkspaceAccessGate>{children}</NoWorkspaceAccessGate>
            </div>
          </main>
        </div>
      </div>
    </TooltipProvider>
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
