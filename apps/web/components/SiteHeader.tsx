import Link from 'next/link';
import { Layers } from 'lucide-react';
import { Button } from './ui/button';

const LINKS = [
  { href: '/docs', label: 'Documentation' },
  { href: '/docs/api', label: 'API' },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-zinc-950/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 shadow-glow">
            <Layers className="h-4 w-4 text-white" />
          </div>
          <span className="text-base font-semibold tracking-tight text-foreground">Tarmac</span>
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <Button asChild size="sm">
          <Link href="/login">Se connecter</Link>
        </Button>
      </div>
    </header>
  );
}
