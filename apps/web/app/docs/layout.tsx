'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';
import { BookOpen, Boxes, Code2 } from 'lucide-react';
import { SiteHeader } from '../../components/SiteHeader';
import { cn } from '../../lib/utils';

const DOCS_NAV = [
  { href: '/docs', label: 'Introduction', icon: BookOpen, exact: true },
  { href: '/docs/concepts', label: 'Concepts clés', icon: Boxes },
  { href: '/docs/api', label: 'Référence API', icon: Code2 },
];

export default function DocsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-10 px-6 py-10">
        <aside className="hidden w-52 shrink-0 lg:block">
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
