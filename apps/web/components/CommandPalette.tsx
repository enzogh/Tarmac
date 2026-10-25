'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Search, type LucideIcon } from 'lucide-react';
import { HardDrive, Layers, Server } from 'lucide-react';
import { api } from '../lib/api';
import { buildNavItems } from '../lib/nav-items';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';

type PaletteResult = {
  key: string;
  label: string;
  sublabel?: string;
  href: string;
  icon: LucideIcon;
};

export function CommandPalette() {
  const router = useRouter();
  const params = useParams<{ workspace: string }>();
  const slug = params.workspace;
  const navResults = useMemo<PaletteResult[]>(
    () =>
      buildNavItems(slug).map((item) => ({
        key: `nav:${item.href}`,
        label: item.label,
        sublabel: 'Page',
        href: item.href,
        icon: item.icon,
      })),
    [slug],
  );
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [entityResults, setEntityResults] = useState<PaletteResult[]>([]);
  const [loaded, setLoaded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    // The header's search affordance advertised ⌘K but wasn't clickable;
    // it now opens the palette through this event rather than needing the
    // layout and the palette to share state.
    const onOpenRequest = () => setOpen(true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('tarmac:open-command-palette', onOpenRequest);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('tarmac:open-command-palette', onOpenRequest);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setSelectedIndex(0);
      return;
    }
    setTimeout(() => inputRef.current?.focus(), 0);
    if (loaded) return;

    void (async () => {
      try {
        const [nodes, mounts, pools] = await Promise.all([
          api.nodes.list(),
          api.mounts.list(),
          api.pools.list(),
        ]);
        setEntityResults([
          ...nodes.map((node) => ({
            key: `node:${node.id}`,
            label: node.name,
            sublabel: `Nœud · ${node.role}`,
            href: `/${slug}/dashboard/infrastructure`,
            icon: Server,
          })),
          ...mounts.map((mount) => ({
            key: `mount:${mount.id}`,
            label: mount.name,
            sublabel: `Montage · ${mount.targetPath}`,
            href: `/${slug}/dashboard/mounts`,
            icon: HardDrive,
          })),
          ...pools.map((pool) => ({
            key: `pool:${pool.id}`,
            label: pool.name,
            sublabel: `Pool · ${pool.strategy}`,
            href: `/${slug}/dashboard/storage`,
            icon: Layers,
          })),
        ]);
      } catch {
        // Best effort — nav items still work if entity fetch fails.
      } finally {
        setLoaded(true);
      }
    })();
  }, [open, loaded]);

  const results = useMemo(() => {
    const all = [...navResults, ...entityResults];
    const q = query.trim().toLowerCase();
    // Without a query: the pages, then a first slice of entities. With one,
    // every match - the list scrolls, and ↑/↓ keep the selection in view.
    if (!q) return all.slice(0, navResults.length + 6);
    return all.filter((item) => item.label.toLowerCase().includes(q) || item.sublabel?.toLowerCase().includes(q)).slice(0, 100);
  }, [query, entityResults, navResults]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const go = (result: PaletteResult) => {
    setOpen(false);
    router.push(result.href);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const result = results[selectedIndex];
      if (result) go(result);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent hideClose aria-describedby={undefined} className="flex max-h-[min(32rem,80vh)] max-w-lg flex-col overflow-hidden p-0">
        <DialogTitle className="sr-only">Recherche rapide</DialogTitle>
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Rechercher un nœud, un montage, un pool, une page…"
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
        <div ref={listRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-2">
          {results.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Aucun résultat.</p>
          )}
          {results.map((result, index) => {
            const Icon = result.icon;
            return (
              <button
                key={result.key}
                type="button"
                data-index={index}
                onClick={() => go(result)}
                // mousemove, not mouseenter: rows scrolled under a still
                // cursor by ↑/↓ must not steal the keyboard selection.
                onMouseMove={() => setSelectedIndex(index)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  index === selectedIndex ? 'bg-violet-500/15 text-foreground' : 'text-muted-foreground'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1 truncate">{result.label}</span>
                {result.sublabel && <span className="shrink-0 text-xs text-muted-foreground">{result.sublabel}</span>}
              </button>
            );
          })}
        </div>
        <div className="shrink-0 border-t border-border px-4 py-2 text-xs text-zinc-600">
          ↑↓ naviguer · Entrée ouvrir · Échap fermer
        </div>
      </DialogContent>
    </Dialog>
  );
}
