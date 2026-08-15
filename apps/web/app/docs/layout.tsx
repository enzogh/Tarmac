'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';
import { BookOpen, Boxes, Code2, Globe, LayoutGrid } from 'lucide-react';
import { SiteHeader } from '../../components/SiteHeader';
import { DiagramDefs } from '../../components/docs/Diagram';
import { cn } from '../../lib/utils';

const DOCS_NAV: { href: string; label: string; icon: typeof BookOpen; exact?: boolean; badge?: string }[] = [
  { href: '/docs', label: 'Introduction', icon: BookOpen, exact: true },
  { href: '/docs/concepts', label: 'Concepts clés', icon: Boxes },
  { href: '/docs/workspaces', label: 'Workspaces & accès', icon: LayoutGrid, badge: 'Nouveau' },
  { href: '/docs/dns', label: 'DNS', icon: Globe, badge: 'Nouveau' },
  { href: '/docs/api', label: 'Référence API', icon: Code2 },
];

export default function DocsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen flex-col">
      {/* Gradients/markers shared by every schema on every docs page. */}
      <DiagramDefs />
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-10 px-6 py-10">
        <aside className="hidden w-56 shrink-0 lg:block">
          <nav className="sticky top-24 space-y-0.5">
            {DOCS_NAV.map((item) => {
              const Icon = item.icon;
              const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-violet-600/15 text-violet-300'
                      : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100'
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {item.label}
                  {item.badge && (
                    <span className="ml-auto rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-300">
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </aside>
        <main className="min-w-0 flex-1 pb-16">{children}</main>
      </div>
    </div>
  );
}
