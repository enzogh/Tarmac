'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowUp, ChevronRight, FolderOpen, RefreshCw, Search } from 'lucide-react';
import { Badge } from './badge';
import { Button } from './button';
import { Input } from './input';

type DirectoryBrowserProps = {
  title: string;
  description?: string;
  currentPath: string;
  selectedPath?: string;
  directories: string[];
  loading?: boolean;
  disabled?: boolean;
  onBrowse: (path: string) => void;
  onSelect: (path: string) => void;
};

function normalizePath(raw: string): string {
  const cleaned = raw.trim().replace(/\/+/g, '/');
  if (!cleaned) return '/';
  if (!cleaned.startsWith('/')) return `/${cleaned}`;
  return cleaned.length > 1 && cleaned.endsWith('/') ? cleaned.slice(0, -1) : cleaned;
}

function getParentPath(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === '/') return '/';
  const chunks = normalized.split('/').filter(Boolean);
  chunks.pop();
  return chunks.length ? `/${chunks.join('/')}` : '/';
}

function splitBreadcrumbs(path: string): Array<{ label: string; path: string }> {
  const normalized = normalizePath(path);
  if (normalized === '/') return [{ label: '/', path: '/' }];

  const chunks = normalized.split('/').filter(Boolean);
  const items: Array<{ label: string; path: string }> = [{ label: '/', path: '/' }];
  let acc = '';
  for (const chunk of chunks) {
    acc += `/${chunk}`;
    items.push({ label: chunk, path: acc });
  }
  return items;
}

export function DirectoryBrowser({
  title,
  description,
  currentPath,
  selectedPath,
  directories,
  loading = false,
  disabled = false,
  onBrowse,
  onSelect,
}: DirectoryBrowserProps) {
  const [pathInput, setPathInput] = useState(currentPath || '/');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setPathInput(currentPath || '/');
  }, [currentPath]);

  const breadcrumbs = useMemo(() => splitBreadcrumbs(currentPath || '/'), [currentPath]);
  const filteredDirectories = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return directories;
    return directories.filter((dir) => dir.toLowerCase().includes(q));
  }, [directories, search]);

  return (
    <div className="space-y-3 rounded-xl border border-white/[0.08] bg-zinc-900/60 p-4">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-zinc-100">{title}</p>
          {selectedPath && (
            <Badge variant="info" className="font-mono text-[10px]">
              sélection: {selectedPath}
            </Badge>
          )}
        </div>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>

      <div className="flex flex-wrap gap-1">
        {breadcrumbs.map((item) => (
          <button
            key={`${item.path}-${item.label}`}
            type="button"
            disabled={disabled || loading}
            onClick={() => onBrowse(item.path)}
            className="rounded-md border border-white/[0.1] bg-zinc-950/70 px-2 py-1 font-mono text-[11px] text-zinc-300 transition hover:border-violet-400/40 hover:text-violet-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="grid gap-2 md:grid-cols-[auto_auto_1fr_auto]">
        <Button
          type="button"
          variant="outline"
          className="h-9"
          disabled={disabled || loading}
          onClick={() => onBrowse(getParentPath(currentPath))}
        >
          <ArrowUp className="mr-1 h-4 w-4" />
          Parent
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-9"
          disabled={disabled || loading}
          onClick={() => onBrowse(currentPath)}
        >
          <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        <Input
          value={pathInput}
          disabled={disabled || loading}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onBrowse(normalizePath(pathInput));
            }
          }}
          className="h-9 font-mono text-xs"
          placeholder="/"
        />
        <Button
          type="button"
          variant="outline"
          className="h-9"
          disabled={disabled || loading}
          onClick={() => onBrowse(normalizePath(pathInput))}
        >
          Ouvrir
        </Button>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
        <Input
          value={search}
          disabled={disabled || loading}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 pl-8 text-xs"
          placeholder="Filtrer les dossiers…"
        />
      </div>

      <div className="max-h-56 space-y-1 overflow-auto rounded-lg border border-white/[0.08] bg-zinc-950/60 p-2">
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => onSelect(currentPath)}
          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition ${
            selectedPath === currentPath
              ? 'bg-violet-500/15 text-violet-100'
              : 'text-zinc-200 hover:bg-white/[0.05]'
          }`}
        >
          <FolderOpen className="h-4 w-4 text-violet-300" />
          <span className="flex-1 truncate font-mono">{currentPath}</span>
          <span className="text-[10px] uppercase tracking-wide text-zinc-400">dossier courant</span>
        </button>

        {loading ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">Lecture en direct…</p>
        ) : filteredDirectories.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">Aucun dossier trouvé.</p>
        ) : (
          filteredDirectories.map((dirPath) => (
            <button
              key={dirPath}
              type="button"
              disabled={disabled}
              onClick={() => {
                onSelect(dirPath);
                onBrowse(dirPath);
              }}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition ${
                selectedPath === dirPath
                  ? 'bg-violet-500/15 text-violet-100'
                  : 'text-zinc-200 hover:bg-white/[0.05]'
              }`}
            >
              <FolderOpen className="h-4 w-4 text-emerald-300" />
              <span className="flex-1 truncate font-mono">{dirPath}</span>
              <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
            </button>
          ))
        )}
      </div>
    </div>
  );
}
