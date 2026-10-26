'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Boxes, ChevronDown, Code2, Globe, KeyRound, LayoutGrid } from 'lucide-react';
import { SiteHeader } from '../../components/SiteHeader';
import { DiagramDefs } from '../../components/docs/Diagram';
import { cn } from '../../lib/utils';

type DocLink = { href: string; label: string; icon: typeof BookOpen; badge?: string };

// Read top to bottom, this is the order someone new should go through the
// docs; previous/next at the bottom of each page follows it too.
const DOCS_GROUPS: { label: string; items: DocLink[] }[] = [
  {
    label: 'Démarrer',
    items: [
      { href: '/docs', label: 'Introduction', icon: BookOpen },
      { href: '/docs/concepts', label: 'Concepts clés', icon: Boxes },
    ],
  },
  {
    label: 'Guides',
    items: [
      { href: '/docs/workspaces', label: 'Membres et rôles', icon: LayoutGrid, badge: 'Rôles' },
      { href: '/docs/dns', label: 'DNS', icon: Globe },
    ],
  },
  {
    label: 'Automatiser',
    items: [
      { href: '/docs/api-keys', label: 'Clés API', icon: KeyRound },
      { href: '/docs/api', label: 'Référence API', icon: Code2 },
    ],
  },
];
const DOCS_ORDER = DOCS_GROUPS.flatMap((group) => group.items);

export default function DocsLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const currentIndex = DOCS_ORDER.findIndex((item) => item.href === pathname);
  const current = DOCS_ORDER[currentIndex];
  const previous = currentIndex > 0 ? DOCS_ORDER[currentIndex - 1] : null;
  const next = currentIndex >= 0 && currentIndex < DOCS_ORDER.length - 1 ? DOCS_ORDER[currentIndex + 1] : null;

  const nav = (
    <nav aria-label="Documentation" className="space-y-5">
      {DOCS_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="px-3 pb-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground/60">{group.label}</p>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'relative flex items-center gap-2.5 rounded-md py-1.5 pl-3 pr-2 text-sm transition-colors',
                    isActive ? 'bg-surface-2 font-medium text-foreground' : 'text-muted-foreground hover:bg-surface-2/60 hover:text-foreground',
                  )}
                >
                  {isActive && <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary" aria-hidden />}
                  <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-primary' : 'text-muted-foreground/70')} />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.badge && (
                    <span className="rounded bg-primary/15 px-1.5 py-px text-[10px] font-medium text-primary">{item.badge}</span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Gradients/markers shared by every schema on every docs page. */}
      <DiagramDefs />
      <SiteHeader />

      {/* Phone and tablet: the page list folds into one button under the header. */}
      <div className="sticky top-14 z-40 border-b border-border bg-background/90 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen((open) => !open)}
          aria-expanded={mobileOpen}
          className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-sm sm:px-6"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="text-muted-foreground">Documentation</span>
            <span className="text-muted-foreground/40">/</span>
            <span className="truncate font-medium text-foreground">{current?.label ?? 'Documentation'}</span>
          </span>
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', mobileOpen && 'rotate-180')} />
        </button>
        {mobileOpen && <div className="max-h-[70vh] overflow-y-auto border-t border-border px-2 py-4 sm:px-4">{nav}</div>}
      </div>

      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-10 px-4 py-8 sm:px-6 lg:py-10">
        <aside className="hidden w-60 shrink-0 lg:block">
          <div className="sticky top-24">{nav}</div>
        </aside>
        <main className="min-w-0 flex-1 pb-16">
          {children}

          {current && (previous || next) && (
            <div className="mt-16 grid gap-3 border-t border-border pt-8 sm:grid-cols-2">
              {previous ? (
                <Link href={previous.href} className="group rounded-xl border border-border bg-surface-1 px-4 py-3 transition-colors hover:border-primary/40">
                  <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                    <ArrowLeft className="h-3 w-3 transition-transform group-hover:-translate-x-0.5" />
                    Précédent
                  </span>
                  <span className="mt-0.5 block text-sm font-medium text-foreground">{previous.label}</span>
                </Link>
              ) : (
                <span className="hidden sm:block" />
              )}
              {next && (
                <Link href={next.href} className="group rounded-xl border border-border bg-surface-1 px-4 py-3 text-right transition-colors hover:border-primary/40">
                  <span className="flex items-center justify-end gap-1.5 text-2xs text-muted-foreground">
                    Suivant
                    <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                  </span>
                  <span className="mt-0.5 block text-sm font-medium text-foreground">{next.label}</span>
                </Link>
              )}
            </div>
          )}
        </main>
      </div>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Tarmac ·{' '}
        <Link href="/" className="hover:text-foreground">
          Accueil
        </Link>{' '}
        ·{' '}
        <Link href="/login" className="hover:text-foreground">
          Console
        </Link>
      </footer>
    </div>
  );
}
