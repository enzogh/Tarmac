'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode } from 'react';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Vue d\'ensemble', icon: '📊' },
  { href: '/dashboard/infrastructure', label: 'Infrastructure', icon: '🖥️' },
  { href: '/dashboard/storage', label: 'Stockage', icon: '📁' },
  { href: '/dashboard/replication', label: 'Réplication', icon: '🔄' },
  { href: '/dashboard/migrations', label: 'Migrations', icon: '➡️' },
  { href: '/dashboard/alerts', label: 'Alertes', icon: '⚠️' },
];

export function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = () => {
    localStorage.removeItem('tarmac_token');
    router.push('/login');
  };

  return (
    <div className="relative flex min-h-screen overflow-hidden bg-slate-950">
      <div className="pointer-events-none absolute inset-0 shell-gradient opacity-80" />

      {/* Sidebar */}
      <div className="relative z-10 flex w-72 flex-col border-r border-white/8 bg-slate-950/70 backdrop-blur-2xl">
        <div className="border-b border-white/8 p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-indigo-500 shadow-glow">
              🏗️
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-slate-50">Tarmac</h1>
              <p className="text-xs text-slate-400">Premium storage dashboard</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-2 px-4 py-6">
          {NAV_ITEMS.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-2xl border px-4 py-3 transition-all duration-200 ${
                  isActive
                    ? 'border-brand-500/20 bg-brand-500/10 text-brand-200 shadow-glow'
                    : 'border-transparent text-slate-300 hover:border-white/10 hover:bg-white/5 hover:text-white'
                }`}
              >
                <span className="text-lg">{item.icon}</span>
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-white/8 p-4">
          <button
            onClick={handleLogout}
            className="btn-secondary w-full justify-center"
          >
            🚪 Déconnexion
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="relative z-10 flex flex-1 flex-col overflow-hidden">
        {/* Top Bar */}
        <div className="flex items-center justify-between border-b border-white/8 bg-slate-950/55 px-6 py-4 backdrop-blur-xl lg:px-8">
          <h2 className="text-lg font-semibold tracking-tight text-slate-50">
            Tableau de bord Tarmac
          </h2>
          <div className="rounded-full border border-white/8 bg-white/5 px-3 py-1.5 text-sm text-slate-300 shadow-insetSoft">
            {new Date().toLocaleDateString('fr-FR', {
              weekday: 'short',
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          <div className="container">{children}</div>
        </div>
      </div>
    </div>
  );
}
