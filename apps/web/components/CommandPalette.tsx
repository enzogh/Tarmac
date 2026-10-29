'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Activity, Bell, Building2, Database, Globe, Globe2, HardDrive, Layers, Network, RefreshCw, Search, Server, Settings, ShieldCheck, Tag, Users, type LucideIcon } from 'lucide-react';
import { api, setCurrentWorkspaceId } from '../lib/api';
import { buildNavItems, navItemArea } from '../lib/nav-items';
import { useWorkspaceAccess } from '../lib/access';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';

type PaletteResult = {
  key: string;
  label: string;
  sublabel?: string;
  href: string;
  icon: LucideIcon;
  // Heading the result is listed under.
  group: string;
  // Other workspaces need a full page load (see WorkspaceSwitcher).
  workspaceId?: string;
};

const SEVERITY_LABEL: Record<string, string> = { critical: 'critique', high: 'élevée', medium: 'moyenne', low: 'faible' };

export function CommandPalette() {
  const router = useRouter();
  const params = useParams<{ workspace: string }>();
  const slug = params.workspace;
  const access = useWorkspaceAccess();
  const navResults = useMemo<PaletteResult[]>(
    () =>
      buildNavItems(slug)
        .filter((item) => {
          const area = navItemArea(item);
          return !area || access.level(area) !== 'none';
        })
        .map((item) => ({
          key: `nav:${item.href}`,
          label: item.label,
          sublabel: 'Page',
          href: item.href,
          icon: item.icon,
          group: 'Pages',
        }))
        // The firewall is one sidebar entry; its tabs stay reachable by name.
        .concat(
          access.level('firewall') !== 'none'
            ? [
                { key: 'nav:firewall-servers', label: 'Entre serveurs', sublabel: 'Pare-feu', href: `/${slug}/dashboard/firewall/servers`, icon: Network, group: 'Pages' },
                { key: 'nav:firewall-internet', label: 'Depuis Internet', sublabel: 'Pare-feu', href: `/${slug}/dashboard/firewall/internet`, icon: Globe2, group: 'Pages' },
                { key: 'nav:firewall-activity', label: 'Activité du pare-feu', sublabel: 'Pare-feu', href: `/${slug}/dashboard/firewall/activity`, icon: Activity, group: 'Pages' },
              ]
            : [],
        )
        .concat(
          access.isManager
            ? [
                { key: 'nav:members', label: 'Membres et invitations', sublabel: 'Paramètres', href: `/${slug}/dashboard/settings?section=members`, icon: Users, group: 'Pages' },
                { key: 'nav:roles', label: 'Rôles personnalisés', sublabel: 'Paramètres', href: `/${slug}/dashboard/settings?section=roles`, icon: Tag, group: 'Pages' },
                { key: 'nav:report', label: 'Rapport hebdomadaire', sublabel: 'Paramètres', href: `/${slug}/dashboard/settings?section=report`, icon: Settings, group: 'Pages' },
              ]
            : [],
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slug, access.ready, access.level, access.isManager],
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

    // Each area is fetched only when the role can see it, and one failing
    // (or forbidden) never hides the others.
    void (async () => {
      const can = (area: Parameters<typeof access.level>[0]) => access.level(area) !== 'none';
      const page = (path: string) => `/${slug}/dashboard/${path}`;
      const sources: Promise<PaletteResult[]>[] = [
        api.workspaces.list().then((workspaces) =>
          workspaces
            .filter((workspace) => workspace.slug !== slug)
            .map((workspace) => ({
              key: `workspace:${workspace.id}`,
              label: workspace.name,
              sublabel: 'Changer de workspace',
              href: `/${workspace.slug}/dashboard`,
              icon: Building2,
              group: 'Workspaces',
              workspaceId: workspace.id,
            })),
        ),
      ];
      if (can('nodes')) {
        sources.push(
          api.nodes.list().then((nodes) =>
            nodes.map((node) => ({ key: `node:${node.id}`, label: node.name, sublabel: `Nœud · ${node.status === 'online' ? 'en ligne' : 'hors ligne'}`, href: page('infrastructure'), icon: Server, group: 'Nœuds' })),
          ),
        );
      }
      if (can('storage')) {
        sources.push(
          api.mounts.list().then((mounts) =>
            mounts.map((mount) => ({ key: `mount:${mount.id}`, label: mount.name, sublabel: `Montage · ${mount.targetPath}`, href: page('mounts'), icon: HardDrive, group: 'Stockage' })),
          ),
          api.pools.list().then((pools) =>
            pools.map((pool) => ({ key: `pool:${pool.id}`, label: pool.name, sublabel: `Pool · ${pool.strategy}`, href: page('storage'), icon: Layers, group: 'Stockage' })),
          ),
          api.shares.list().then((shares) =>
            shares.map((share) => ({ key: `share:${share.id}`, label: share.name, sublabel: `Partage · ${share.path}`, href: page('storage'), icon: Database, group: 'Stockage' })),
          ),
          api.syncJobs.list().then((jobs) =>
            jobs.map((job) => ({ key: `sync:${job.id}`, label: job.name, sublabel: 'Réplication', href: page('replication'), icon: RefreshCw, group: 'Stockage' })),
          ),
        );
      }
      if (can('dns')) {
        sources.push(
          api.dns.zones.list().then((zones) =>
            zones.map((zone) => ({ key: `zone:${zone.id}`, label: zone.name, sublabel: 'Zone DNS', href: page('dns'), icon: Globe, group: 'Réseau' })),
          ),
        );
      }
      if (can('vpn')) {
        sources.push(
          api.vpn.list().then((profiles) =>
            profiles.map((profile) => ({ key: `vpn:${profile.id}`, label: profile.name, sublabel: 'Profil VPN', href: page('vpn'), icon: ShieldCheck, group: 'Réseau' })),
          ),
        );
      }
      if (can('alerts')) {
        sources.push(
          api.alerts.list().then((alerts) =>
            alerts
              .filter((alert) => alert.status !== 'resolved')
              .slice(0, 50)
              .map((alert) => ({ key: `alert:${alert.id}`, label: alert.message, sublabel: `Alerte ${SEVERITY_LABEL[alert.severity] ?? ''}`.trim(), href: page('alerts'), icon: Bell, group: 'Alertes ouvertes' })),
          ),
        );
      }
      const settled = await Promise.allSettled(sources);
      setEntityResults(settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])));
      setLoaded(true);
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
    if (result.workspaceId) {
      setCurrentWorkspaceId(result.workspaceId);
      window.location.href = result.href;
      return;
    }
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
            placeholder="Rechercher un nœud, un partage, une zone DNS, une alerte, une page…"
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
        <div ref={listRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-2">
          {results.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Aucun résultat.</p>
          )}
          {results.map((result, index) => {
            const Icon = result.icon;
            const heading = index === 0 || results[index - 1].group !== result.group ? result.group : null;
            return (
              <div key={result.key}>
              {heading && <p className="px-3 pb-1 pt-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground/60">{heading}</p>}
              <button
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
                {result.sublabel && <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">{result.sublabel}</span>}
              </button>
              </div>
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
