'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, type LucideIcon } from 'lucide-react';
import { HardDrive, Layers, Server } from 'lucide-react';
import { api } from '../lib/api';
import { NAV_ITEMS } from '../lib/nav-items';
import { Dialog, DialogContent } from './ui/dialog';

type PaletteResult = {
  key: string;
  label: string;
  sublabel?: string;
  href: string;
  icon: LucideIcon;
};

const NAV_RESULTS: PaletteResult[] = NAV_ITEMS.map((item) => ({
  key: `nav:${item.href}`,
  label: item.label,
  sublabel: 'Page',
  href: item.href,
  icon: item.icon,
}));

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [entityResults, setEntityResults] = useState<PaletteResult[]>([]);
  const [loaded, setLoaded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
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
            href: '/dashboard/infrastructure',
            icon: Server,
          })),
          ...mounts.map((mount) => ({
            key: `mount:${mount.id}`,
            label: mount.name,
            sublabel: `Montage · ${mount.targetPath}`,
            href: '/dashboard/mounts',
            icon: HardDrive,
          })),
          ...pools.map((pool) => ({
            key: `pool:${pool.id}`,
            label: pool.name,
            sublabel: `Pool · ${pool.strategy}`,
            href: '/dashboard/storage',
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
    const all = [...NAV_RESULTS, ...entityResults];
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 8);
    return all.filter((item) => item.label.toLowerCase().includes(q) || item.sublabel?.toLowerCase().includes(q)).slice(0, 8);
  }, [query, entityResults]);

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
      <DialogContent className="max-w-lg p-0">
        <div className="flex items-center gap-2 border-b border-white/[0.08] px-4 py-3">
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
        <div className="max-h-80 overflow-y-auto p-2">
          {results.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Aucun résultat.</p>
          )}
          {results.map((result, index) => {
            const Icon = result.icon;
            return (
              <button
                key={result.key}
                type="button"
                onClick={() => go(result)}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  index === selectedIndex ? 'bg-violet-500/15 text-foreground' : 'text-muted-foreground hover:bg-white/5'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1 truncate">{result.label}</span>
                {result.sublabel && <span className="shrink-0 text-xs text-zinc-500">{result.sublabel}</span>}
              </button>
            );
          })}
        </div>
        <div className="border-t border-white/[0.08] px-4 py-2 text-xs text-zinc-600">
          ↑↓ naviguer · Entrée ouvrir · Échap fermer
        </div>
      </DialogContent>
    </Dialog>
  );
}
