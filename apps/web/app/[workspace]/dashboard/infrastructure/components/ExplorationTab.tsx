'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUp,
  BarChart3,
  ChevronRight,
  Folder,
  FolderOpen,
  HardDrive,
  LoaderCircle,
  RefreshCw,
  Search,
  ServerOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NODE_STATUS, StatusDot, describe } from '@/components/ui/status';
import { api, DirectoryScanEntry, NodeActivityItem } from '@/lib/api';
import { formatBytes, formatCapacity, shortHostname } from '@/lib/format';
import { cn } from '@/lib/utils';
import { MiniMeter } from './node-ui';

type Scan = { entries: DirectoryScanEntry[]; truncated: boolean; at: number };

const normalize = (path: string) => {
  const cleaned = path.trim().replace(/\/+/g, '/');
  if (!cleaned || cleaned === '/') return '/';
  const absolute = cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
  return absolute.endsWith('/') ? absolute.slice(0, -1) : absolute;
};
const parentOf = (path: string) => {
  const parts = normalize(path).split('/').filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join('/')}` : '/';
};
const baseName = (path: string) => normalize(path).split('/').filter(Boolean).pop() ?? '/';
const crumbs = (path: string) => {
  const parts = normalize(path).split('/').filter(Boolean);
  return [{ label: 'Racine', path: '/' }, ...parts.map((part, index) => ({ label: part, path: `/${parts.slice(0, index + 1).join('/')}` }))];
};

function NodeList({ nodes, selectedId, onSelect }: { nodes: NodeActivityItem[]; selectedId: string; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...nodes]
      .filter((node) => !needle || node.name.toLowerCase().includes(needle))
      .sort((left, right) => Number(left.status === 'offline') - Number(right.status === 'offline') || left.name.localeCompare(right.name));
  }, [nodes, query]);

  return (
    <aside className="flex min-h-0 flex-col border-b border-border lg:border-b-0 lg:border-r">
      <div className="border-b border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Chercher un nœud…" className="h-8 pl-8 text-xs" />
        </div>
      </div>
      <div className="max-h-64 flex-1 overflow-y-auto p-1.5 lg:max-h-[34rem]">
        {visible.map((node) => {
          const offline = node.status === 'offline';
          const active = node.id === selectedId;
          return (
            <button
              key={node.id}
              type="button"
              onClick={() => onSelect(node.id)}
              disabled={offline}
              title={offline ? `${node.name} est hors ligne : son agent ne peut pas lister les dossiers` : node.name}
              className={cn(
                'flex w-full flex-col gap-1.5 rounded-lg px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                active ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-surface-2',
              )}
            >
              <span className="flex items-center gap-2">
                <StatusDot tone={describe(NODE_STATUS, node.status).tone} />
                <span className={cn('truncate text-sm', active ? 'font-medium text-foreground' : 'text-foreground/90')}>{shortHostname(node.name)}</span>
                {offline && <span className="ml-auto text-2xs text-muted-foreground">hors ligne</span>}
              </span>
              {!offline && node.storage.totalCapacityGb > 0 && (
                <span className="flex items-center gap-2 pl-4 text-2xs text-muted-foreground">
                  <MiniMeter value={node.storage.usageRatio * 100} className="flex-1" />
                  <span className="shrink-0 tabular-nums">{formatCapacity(node.storage.totalCapacityGb)}</span>
                </span>
              )}
            </button>
          );
        })}
        {visible.length === 0 && <p className="px-3 py-6 text-center text-xs text-muted-foreground">Aucun nœud.</p>}
      </div>
    </aside>
  );
}

export function ExplorationTab({ nodes }: { nodes: NodeActivityItem[] }) {
  const [nodeId, setNodeId] = useState('');
  const [path, setPath] = useState('/');
  const [pathInput, setPathInput] = useState('/');
  const [directories, setDirectories] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [listing, setListing] = useState(false);
  const [scanning, setScanning] = useState(false);
  // Kept per node and folder for the session, so going back up shows the
  // analysis already run instead of an empty panel.
  const [scans, setScans] = useState<Record<string, Scan>>({});
  // Explorer failures belong to this panel, not to the page-wide notice: a
  // node whose agent simply can't be browsed is normal.
  const [error, setError] = useState<string | null>(null);

  const node = nodes.find((item) => item.id === nodeId) ?? null;
  const scanKey = `${nodeId}:${path}`;
  const scan = scans[scanKey];

  const browse = async (id: string, target: string) => {
    if (!id) return;
    setListing(true);
    setError(null);
    setFilter('');
    try {
      const payload = await api.migrations.listDirectories(id, normalize(target));
      const resolved = normalize(payload.basePath);
      setPath(resolved);
      setPathInput(resolved);
      setDirectories([...payload.directories].sort((a, b) => baseName(a).localeCompare(baseName(b))));
    } catch {
      setError('Impossible de lister ce dossier : agent injoignable, dossier inexistant ou accès refusé.');
    } finally {
      setListing(false);
    }
  };

  const analyse = async () => {
    if (!nodeId) return;
    setScanning(true);
    setError(null);
    try {
      const payload = await api.migrations.scanDirectories(nodeId, path, 20);
      setScans((current) => ({ ...current, [scanKey]: { entries: payload.entries ?? [], truncated: payload.truncated, at: Date.now() } }));
    } catch {
      setError('L’analyse n’a pas abouti. Vérifiez que l’agent du nœud est en ligne, puis réessayez.');
    } finally {
      setScanning(false);
    }
  };

  const selectNode = (id: string) => {
    setNodeId(id);
    setDirectories([]);
    void browse(id, '/');
  };

  useEffect(() => {
    if (nodes.length === 0 || nodes.some((item) => item.id === nodeId)) return;
    const first = nodes.find((item) => item.status === 'online') ?? null;
    if (first) selectNode(first.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, nodeId]);

  const volumes = useMemo(
    () => (node?.storage.disks ?? []).filter((disk, index, all) => all.findIndex((other) => other.mountPath === disk.mountPath) === index),
    [node],
  );
  const visibleDirectories = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle ? directories.filter((dir) => baseName(dir).toLowerCase().includes(needle)) : directories;
  }, [directories, filter]);
  const scanTotal = scan?.entries.reduce((acc, entry) => acc + entry.sizeBytes, 0) ?? 0;
  const scanMax = scan?.entries[0]?.sizeBytes ?? 1;

  if (nodes.length === 0) {
    return <Card className="py-12 text-center text-sm text-muted-foreground">Aucun nœud enregistré pour le moment.</Card>;
  }

  return (
    <Card className="grid overflow-hidden animate-fade-in lg:grid-cols-[17rem_minmax(0,1fr)]">
      <NodeList nodes={nodes} selectedId={nodeId} onSelect={selectNode} />

      {!node ? (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
          <ServerOff className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-foreground">Aucun nœud en ligne à explorer</p>
          <p className="text-xs text-muted-foreground">L’exploration passe par l’agent du nœud : il doit être connecté.</p>
        </div>
      ) : (
        <div className="flex min-w-0 flex-col">
          <div className="space-y-3 border-b border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground" title={node.name}>
                  {node.name}
                </p>
                <p className="text-2xs text-muted-foreground">Lecture en direct via l’agent. Rien n’est modifié sur le serveur.</p>
              </div>
              <Button size="sm" onClick={() => void analyse()} disabled={scanning || listing} className="gap-1.5">
                {scanning ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <BarChart3 className="h-3.5 w-3.5" />}
                {scanning ? 'Analyse en cours…' : scan ? 'Relancer l’analyse' : 'Analyser l’espace occupé'}
              </Button>
            </div>

            {volumes.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-2xs uppercase tracking-wider text-muted-foreground">Volumes</span>
                {volumes.map((disk) => (
                  <button
                    key={disk.id}
                    type="button"
                    onClick={() => void browse(node.id, disk.mountPath)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-2xs transition-colors',
                      path === normalize(disk.mountPath) ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-border hover:bg-surface-2',
                    )}
                    title={`${disk.name} · ${formatCapacity(disk.usedGb)} / ${formatCapacity(disk.capacityGb)}`}
                  >
                    <HardDrive className="h-3 w-3 text-muted-foreground" />
                    <span className="font-mono">{disk.mountPath}</span>
                    <span className={cn('tabular-nums', disk.usageRatio >= 0.85 ? 'text-[hsl(var(--danger))]' : 'text-muted-foreground')}>
                      {Math.round(disk.usageRatio * 100)} %
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-center gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                className="h-8 w-8 shrink-0 p-0"
                onClick={() => void browse(node.id, parentOf(path))}
                disabled={listing || path === '/'}
                aria-label="Dossier parent"
                title="Dossier parent"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <form
                className="flex min-w-0 flex-1 items-center rounded-lg border border-border bg-background focus-within:ring-1 focus-within:ring-primary/40"
                onSubmit={(event) => {
                  event.preventDefault();
                  void browse(node.id, pathInput);
                }}
              >
                <nav className="hidden min-w-0 items-center gap-0.5 overflow-x-auto px-2 sm:flex" aria-label="Chemin">
                  {crumbs(path).map((crumb, index, all) => (
                    <span key={crumb.path} className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => void browse(node.id, crumb.path)}
                        className={cn(
                          'rounded px-1.5 py-1 font-mono text-xs transition-colors hover:bg-surface-2',
                          index === all.length - 1 ? 'text-foreground' : 'text-muted-foreground',
                        )}
                      >
                        {crumb.label}
                      </button>
                      {index < all.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground/60" />}
                    </span>
                  ))}
                </nav>
                <Input
                  value={pathInput}
                  onChange={(event) => setPathInput(event.target.value)}
                  className="h-8 min-w-[6rem] flex-1 border-0 bg-transparent font-mono text-xs shadow-none focus-visible:ring-0 sm:max-w-[14rem] sm:border-l sm:border-border"
                  aria-label="Aller au chemin"
                  placeholder="/chemin/vers/dossier"
                />
              </form>
              <Button
                variant="secondary"
                size="sm"
                className="h-8 w-8 shrink-0 p-0"
                onClick={() => void browse(node.id, path)}
                disabled={listing}
                aria-label="Actualiser"
                title="Actualiser"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', listing && 'animate-spin')} />
              </Button>
            </div>
            {error && <p className="rounded-md border border-[hsl(var(--danger))]/30 bg-[hsl(var(--danger))]/10 px-3 py-2 text-xs text-[hsl(var(--danger))]">{error}</p>}
          </div>

          <div className="grid min-h-[22rem] flex-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <section className="flex min-h-0 flex-col border-b border-border xl:border-b-0 xl:border-r">
              <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
                <h4 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Dossiers{!listing && ` · ${directories.length}`}
                </h4>
                {directories.length > 8 && (
                  <Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filtrer…" className="h-7 w-36 text-xs" />
                )}
              </div>
              <div className="max-h-[26rem] flex-1 overflow-y-auto px-2 pb-2">
                {listing ? (
                  <div className="space-y-1 px-2 py-1">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <div key={index} className="h-7 animate-pulse rounded-md bg-surface-2" />
                    ))}
                  </div>
                ) : visibleDirectories.length === 0 ? (
                  <p className="flex flex-col items-center gap-1 px-3 py-10 text-center text-xs text-muted-foreground">
                    <FolderOpen className="h-5 w-5" />
                    {directories.length === 0 ? 'Ce dossier ne contient aucun sous-dossier.' : 'Aucun dossier ne correspond au filtre.'}
                  </p>
                ) : (
                  visibleDirectories.map((dir) => (
                    <button
                      key={dir}
                      type="button"
                      onClick={() => void browse(node.id, dir)}
                      className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-surface-2"
                    >
                      <Folder className="h-4 w-4 shrink-0 text-primary/80 group-hover:text-primary" />
                      <span className="flex-1 truncate font-mono text-xs text-foreground/90">{baseName(dir)}</span>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                  ))
                )}
              </div>
            </section>

            <section className="flex min-h-0 flex-col">
              <div className="flex items-baseline justify-between gap-2 px-4 pb-2 pt-3">
                <h4 className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Ce qui occupe la place</h4>
                {scan && (
                  <span className="text-2xs text-muted-foreground">
                    {formatBytes(scanTotal)} analysés · {new Date(scan.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
              <div className="max-h-[26rem] flex-1 overflow-y-auto px-4 pb-4">
                {scanning && !scan ? (
                  <div className="flex flex-col items-center gap-2 py-12 text-center text-xs text-muted-foreground">
                    <LoaderCircle className="h-5 w-5 animate-spin text-primary" />
                    Calcul de la taille des sous-dossiers de <span className="font-mono text-foreground">{path}</span>…
                    <span>Sur un gros volume, cela peut prendre une minute.</span>
                  </div>
                ) : !scan ? (
                  <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-10 text-center">
                    <BarChart3 className="h-6 w-6 text-muted-foreground" />
                    <div className="space-y-1">
                      <p className="text-sm text-foreground">Où est passé l’espace disque ?</p>
                      <p className="text-xs text-muted-foreground">
                        L’analyse classe les sous-dossiers de <span className="font-mono text-foreground">{path}</span> du plus lourd au plus léger.
                      </p>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => void analyse()} disabled={listing} className="gap-1.5">
                      <BarChart3 className="h-3.5 w-3.5" />
                      Analyser ce dossier
                    </Button>
                  </div>
                ) : scan.entries.length === 0 ? (
                  <p className="py-10 text-center text-xs text-muted-foreground">Rien à mesurer ici : aucun sous-dossier non vide.</p>
                ) : (
                  <ol className={cn('space-y-1', scanning && 'opacity-60')}>
                    {scan.entries.map((entry, index) => (
                      <li key={entry.path}>
                        <button
                          type="button"
                          onClick={() => void browse(node.id, entry.path)}
                          className="group w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
                          title={`Ouvrir ${entry.path}`}
                        >
                          <span className="flex items-center gap-2 text-xs">
                            <span className="w-4 shrink-0 text-right text-2xs tabular-nums text-muted-foreground">{index + 1}</span>
                            <span className="flex-1 truncate font-mono text-foreground/90">{entry.path}</span>
                            <span className="shrink-0 font-medium tabular-nums text-foreground">{formatBytes(entry.sizeBytes)}</span>
                            <span className="w-9 shrink-0 text-right text-2xs tabular-nums text-muted-foreground">
                              {scanTotal ? Math.round((entry.sizeBytes / scanTotal) * 100) : 0} %
                            </span>
                          </span>
                          <span className="ml-6 mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-3">
                            <span
                              className={cn('block h-full rounded-full', index === 0 ? 'bg-primary' : 'bg-primary/60')}
                              style={{ width: `${Math.max(1.5, (entry.sizeBytes / scanMax) * 100)}%` }}
                            />
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
                {scan?.truncated && (
                  <p className="mt-3 text-2xs text-[hsl(var(--warn))]">Résultat partiel : l’analyse est bornée dans le temps pour rester réactive.</p>
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </Card>
  );
}
