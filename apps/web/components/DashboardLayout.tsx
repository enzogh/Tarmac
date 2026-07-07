'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode } from 'react';
import {
  LayoutDashboard,
  Server,
  Database,
  RefreshCw,
  ArrowRightLeft,
  Bell,
  LogOut,
  Layers,
  Network,
  HardDrive,
  UserCog,
  BookOpen,
  type LucideIcon,
} from 'lucide-react';
import { Button } from './ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { cn } from '../lib/utils';

type NavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean };
type NavGroup = { label: string | null; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [{ href: '/dashboard', label: "Vue d'ensemble", icon: LayoutDashboard, exact: true }],
  },
  {
    label: 'Infrastructure',
    items: [
      { href: '/dashboard/infrastructure', label: 'Nœuds', icon: Server },
      { href: '/dashboard/network', label: 'Réseau', icon: Network },
    ],
  },
  {
    label: 'Stockage',
    items: [
      { href: '/dashboard/storage', label: 'Stockage', icon: Database },
      { href: '/dashboard/mounts', label: 'Montages', icon: HardDrive },
      { href: '/dashboard/replication', label: 'Réplication', icon: RefreshCw },
      { href: '/dashboard/migrations', label: 'Migrations', icon: ArrowRightLeft },
    ],
  },
  {
    label: 'Supervision',
    items: [{ href: '/dashboard/alerts', label: 'Alertes', icon: Bell }],
  },
  {
    label: 'Compte',
    items: [{ href: '/dashboard/profile', label: 'Profil admin', icon: UserCog }],
  },
];

const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

export function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = () => {
    localStorage.removeItem('tarmac_token');
    router.push('/login');
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="relative flex min-h-screen overflow-hidden">
        {/* Sidebar */}
        <aside className="relative z-10 flex w-64 flex-col border-r border-white/[0.06] bg-zinc-950/80 backdrop-blur-2xl">
          {/* Logo */}
          <div className="border-b border-white/[0.06] px-5 py-5">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 shadow-glow">
                <Layers className="h-4 w-4 text-white" />
              </div>
              <div>
                <h1 className="text-base font-semibold tracking-tight text-foreground">Tarmac</h1>
                <p className="text-[11px] text-muted-foreground">Storage dashboard</p>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
            {NAV_GROUPS.map((group, groupIndex) => (
              <div key={group.label ?? `group-${groupIndex}`} className="space-y-0.5">
                {group.label && (
                  <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-600">
                    {group.label}
                  </p>
                )}
                {group.items.map((item) => {
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
                      <Icon
                        className={cn('h-4 w-4 shrink-0', isActive ? 'text-violet-400' : 'text-zinc-500')}
                      />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* Footer */}
          <div className="space-y-1 border-t border-white/[0.06] p-3">
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
          <header className="flex items-center justify-between border-b border-white/[0.06] bg-zinc-950/60 px-6 py-3.5 backdrop-blur-xl">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
              <span className="text-sm font-medium text-foreground">Tarmac</span>
              <span className="text-zinc-600 text-sm">/</span>
              <span className="text-sm text-muted-foreground">
                {NAV_ITEMS.find(
                  (n) =>
                    n.exact
                      ? pathname === n.href
                      : pathname === n.href || pathname.startsWith(n.href + '/')
                )?.label ?? 'Dashboard'}
              </span>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-xs text-muted-foreground">
              {new Date().toLocaleDateString('fr-FR', {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </div>
          </header>

          {/* Content */}
          <main className="flex-1 overflow-auto">
            <div className="mx-auto max-w-7xl px-6 py-8 lg:px-8">{children}</div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
