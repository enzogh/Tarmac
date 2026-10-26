'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowRight, Menu, X } from 'lucide-react';
import { BrandMark } from './BrandMark';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

const LINKS = [
  { href: '/#fonctionnalites', label: 'Fonctionnalités' },
  { href: '/#acces', label: 'Rôles & API' },
  { href: '/docs', label: 'Documentation' },
  { href: '/docs/api', label: 'Référence API' },
];

// Shared by the landing page and the documentation: one header, so moving
// between the two never feels like changing site.
export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  const isActive = (href: string) => !href.includes('#') && (href === '/docs' ? pathname === '/docs' || (pathname.startsWith('/docs/') && !pathname.startsWith('/docs/api')) : pathname.startsWith(href));

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Tarmac, accueil">
          <BrandMark size="md" />
          <span className="text-base font-semibold tracking-tight text-foreground">Tarmac</span>
        </Link>

        <nav className="hidden items-center gap-0.5 md:flex" aria-label="Navigation principale">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition-colors',
                isActive(link.href) ? 'bg-surface-2 text-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Button asChild size="sm" className="gap-1.5">
            <Link href="/login">
              Se connecter
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground md:hidden"
            aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'}
            aria-expanded={open}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {open && (
        <nav className="border-t border-border px-4 py-2 md:hidden" aria-label="Navigation principale">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className={cn('block rounded-md px-3 py-2.5 text-sm', isActive(link.href) ? 'bg-surface-2 text-foreground' : 'text-muted-foreground')}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
