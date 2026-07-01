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
    <div className="flex h-screen bg-slate-950">
      {/* Sidebar */}
      <div className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col">
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-2xl font-bold text-blue-400">🏗️ Tarmac</h1>
          <p className="text-xs text-slate-400 mt-1">Storage Dashboard</p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-6 space-y-2">
          {NAV_ITEMS.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-blue-600/20 text-blue-300 border border-blue-600/30'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                <span className="text-xl">{item.icon}</span>
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800">
          <button
            onClick={handleLogout}
            className="btn-secondary w-full flex items-center justify-center gap-2"
          >
            🚪 Déconnexion
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <div className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-slate-100">
            Tableau de bord Tarmac
          </h2>
          <div className="text-sm text-slate-400">
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
