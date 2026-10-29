'use client';

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Bell,
  CalendarClock,
  ChevronDown,
  Download,
  FolderSync,
  Globe,
  HardDrive,
  History,
  KeyRound,
  LayoutGrid,
  LoaderCircle,
  Network,
  PauseCircle,
  PlayCircle,
  Search,
  Server,
  ShieldCheck,
  Terminal,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, AgentLogItem, AuditLogItem } from '../../../../lib/api';
import {
  AuditCategory,
  auditCategory,
  auditVerb,
  DETAIL_LABEL,
  FIELD_LABEL,
  RESOURCE_FILTER_LABEL,
  RESOURCE_LABEL,
} from '../../../../lib/audit-vocabulary';
import { usePolling } from '../../../../lib/hooks/usePolling';
import { ExportMenu } from '../../../../components/ExportMenu';
import { useLiveSocket } from '../../../../lib/hooks/useLiveSocket';
import { shortHostname } from '../../../../lib/format';
import { cn } from '../../../../lib/utils';
import { PageHeader } from '../../../../components/PageHeader';
import { Card } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../../components/ui/tabs';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '../../../../components/ui/dropdown-menu';
import { ListSkeleton } from '../../../../components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../components/ui/tooltip';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../../components/ui/dialog';
import { Alert, AlertDescription } from '../../../../components/ui/alert';
import { useWorkspace } from '../../../../lib/workspace-context';

const ANY = '__any__';

// resourceType -> where an audit entry's affected resource can be reviewed,
// relative to the active workspace's /<slug>/dashboard root.
const RESOURCE_ROUTES: Record<string, string> = {
  node: '/infrastructure',
  vpn_profile: '/vpn',
  api_key: '/api-keys',
  migration: '/migrations',
  mount: '/mounts',
  share: '/mounts',
  pool: '/storage',
  pool_member: '/storage',
  sync_job: '/replication',
  sync_job_run: '/replication',
  alert: '/alerts',
  alert_rule: '/alerts',
  dns_zone: '/dns',
  dns_record: '/dns',
  dns_server_group: '/dns',
  dns_server_group_member: '/dns',
  workspace: '/settings',
};

const CATEGORY_STYLE: Record<AuditCategory, { icon: LucideIcon; className: string }> = {
  node: { icon: Server, className: 'bg-primary/10 text-primary' },
  network: { icon: Network, className: 'bg-[hsl(var(--info))]/10 text-[hsl(var(--info))]' },
  vpn: { icon: ShieldCheck, className: 'bg-[hsl(var(--info))]/10 text-[hsl(var(--info))]' },
  dns: { icon: Globe, className: 'bg-[hsl(var(--chart-3))]/10 text-[hsl(var(--chart-3))]' },
  storage: { icon: HardDrive, className: 'bg-[hsl(var(--chart-4))]/10 text-[hsl(var(--chart-4))]' },
  transfer: { icon: FolderSync, className: 'bg-[hsl(var(--chart-5))]/10 text-[hsl(var(--chart-5))]' },
  alert: { icon: Bell, className: 'bg-[hsl(var(--warn))]/10 text-[hsl(var(--warn))]' },
  access: { icon: KeyRound, className: 'bg-[hsl(var(--danger))]/10 text-[hsl(var(--danger))]' },
  workspace: { icon: LayoutGrid, className: 'bg-surface-3 text-muted-foreground' },
};

type Period = '24h' | '7d' | '30d' | 'all';
const PERIODS: Record<Period, { label: string; ms: number | null }> = {
  '24h': { label: 'Dernières 24 h', ms: 24 * 3600e3 },
  '7d': { label: '7 derniers jours', ms: 7 * 24 * 3600e3 },
  '30d': { label: '30 derniers jours', ms: 30 * 24 * 3600e3 },
  all: { label: 'Tout l’historique', ms: null },
};
const periodStart = (period: Period) => {
  const ms = PERIODS[period].ms;
  return ms === null ? undefined : new Date(Date.now() - ms).toISOString();
};

const formatClock = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const startOf = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(date)) / 86_400_000);
  if (diff === 0) return 'Aujourd’hui';
  if (diff === 1) return 'Hier';
  const label = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function initials(name: string) {
  const parts = name.split(/[\s.@_-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

// Changes made with a workspace API key carry the key in their details.
function apiKeyActor(details: unknown): string | null {
  const apiKey = (details as { apiKey?: { name?: string } } | null)?.apiKey;
  return apiKey?.name ? apiKey.name : null;
}

function Actor({ entry }: { entry: AuditLogItem }) {
  const viaKey = apiKeyActor(entry.details);
  if (entry.actor) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-default items-center gap-1.5 font-medium text-foreground">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[9px] font-semibold text-primary">{initials(entry.actor.name)}</span>
            {entry.actor.name}
          </span>
        </TooltipTrigger>
        <TooltipContent>{entry.actor.email}</TooltipContent>
      </Tooltip>
    );
  }
  if (viaKey) {
    return (
      <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
        <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
        Clé API « {viaKey} »
      </span>
    );
  }
  if (entry.actorUserId) return <span className="font-medium text-foreground">Utilisateur supprimé</span>;
  return <span className="font-medium text-foreground">Tarmac</span>;
}

function DetailValue({ value, refs }: { value: unknown; refs: Record<string, string> }) {
  if (value === null || value === undefined || value === '') return <span className="text-muted-foreground">—</span>;
  if (typeof value === 'boolean') return <>{value ? 'oui' : 'non'}</>;
  if (typeof value === 'string') {
    const name = refs[value];
    return name ? (
      <span title={value} className="font-medium text-foreground">
        {shortHostname(name)}
      </span>
    ) : (
      <span className="break-all">{value}</span>
    );
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">aucun</span>;
    if (value.length > 6 && value.every((item) => typeof item === 'string' && !refs[item])) return <>{value.length} éléments</>;
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((item, index) => (
          <span key={index} className="rounded border border-border bg-surface-2 px-1.5 py-px">
            {typeof item === 'string' ? (FIELD_LABEL[item] ?? refs[item] ?? item) : JSON.stringify(item)}
          </span>
        ))}
      </span>
    );
  }
  if (typeof value === 'object') {
    const name = (value as { name?: unknown }).name;
    return <>{typeof name === 'string' ? name : <code className="break-all text-2xs">{JSON.stringify(value)}</code>}</>;
  }
  return <>{String(value)}</>;
}

function AuditDetails({ entry, refs }: { entry: AuditLogItem; refs: Record<string, string> }) {
  const [raw, setRaw] = useState(false);
  const details = entry.details && typeof entry.details === 'object' && !Array.isArray(entry.details) ? (entry.details as Record<string, unknown>) : null;
  const order = (key: string) => ['name', 'from', 'to'].indexOf(key) + 1 || 9;
  const fields = details ? Object.entries(details).filter(([key]) => key !== 'apiKey').sort(([a], [b]) => order(a) - order(b)) : [];
  return (
    <div className="mt-2 rounded-lg border border-border bg-surface-2/50 p-3 text-xs">
      {fields.length > 0 && !raw && (
        <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-1.5">
          {fields.map(([key, value]) => (
            <Fragment key={key}>
              <dt className="text-muted-foreground">{DETAIL_LABEL[key] ?? key}</dt>
              <dd className="min-w-0 text-foreground/90">
                <DetailValue value={value} refs={refs} />
              </dd>
            </Fragment>
          ))}
        </dl>
      )}
      {(raw || fields.length === 0) && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-2xs text-muted-foreground">
          {JSON.stringify({ action: entry.action, resourceType: entry.resourceType, resourceId: entry.resourceId, details: entry.details }, null, 2)}
        </pre>
      )}
      <button type="button" onClick={() => setRaw((value) => !value)} className="mt-2 text-2xs text-muted-foreground hover:text-foreground">
        {raw ? 'Vue lisible' : 'Données brutes'}
      </button>
    </div>
  );
}

function AuditRow({ entry, refs, slug, onDelete }: { entry: AuditLogItem; refs: Record<string, string>; slug: string; onDelete?: () => void }) {
  const [open, setOpen] = useState(false);
  const category = CATEGORY_STYLE[auditCategory(entry.resourceType)];
  const { verb, needsResource } = auditVerb(entry.action, entry.resourceType);
  const detailsName = (entry.details as { name?: unknown } | null)?.name;
  const resourceName =
    (entry.resourceId && refs[entry.resourceId]) || (typeof detailsName === 'string' ? detailsName : null) || (entry.resourceId ? entry.resourceId.slice(0, 8) : null);
  const deleted = entry.resourceId && !refs[entry.resourceId];
  const route = RESOURCE_ROUTES[entry.resourceType];

  return (
    <li className="group flex gap-3 px-4 py-3 transition-colors hover:bg-surface-2/40 lg:px-5">
      <span className="w-11 shrink-0 pt-0.5 text-right text-2xs tabular-nums text-muted-foreground" title={new Date(entry.createdAt).toLocaleString('fr-FR')}>
        {formatClock(entry.createdAt)}
      </span>
      <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', category.className)}>
        <category.icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-6 text-muted-foreground">
          <Actor entry={entry} /> {verb}
          {needsResource && resourceName && (
            <>
              {' '}
              {route && !deleted ? (
                <Link href={`/${slug}/dashboard${route}`} className="font-medium text-foreground underline-offset-2 hover:text-primary hover:underline">
                  {shortHostname(resourceName)}
                </Link>
              ) : (
                <span className="font-medium text-foreground">{shortHostname(resourceName)}</span>
              )}
            </>
          )}
        </p>
        {open && <AuditDetails entry={entry} refs={refs} />}
      </div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-2xs text-muted-foreground transition-opacity hover:bg-surface-2 hover:text-foreground',
          !open && 'opacity-60 group-hover:opacity-100',
        )}
        aria-expanded={open}
      >
        Détails
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-[hsl(var(--danger))]/10 hover:text-[hsl(var(--danger))] focus-visible:opacity-100 group-hover:opacity-100"
          aria-label="Supprimer cette entrée du journal"
          title="Supprimer cette entrée"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}

type PurgeRequest = {
  title: string;
  description: string;
  // What exactly goes, line by line ("Période : 7 derniers jours"...).
  scope: Array<{ label: string; value: string }>;
  confirmLabel: string;
  // Extra choice inside the dialog (the agents tab picks a time range).
  options?: { label: string; value: string }[];
  run: (option?: string) => Promise<number>;
};

/**
 * Deleting journal entries is reserved to platform admins and can't be
 * undone, so it always goes through this dialog: what will be deleted, in
 * which workspace, and a plain warning - never a one-click delete.
 */
function PurgeDialog({ request, onClose }: { request: PurgeRequest | null; onClose: () => void }) {
  const { currentWorkspace } = useWorkspace();
  const [option, setOption] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  useEffect(() => {
    setOption(request?.options?.[0]?.value);
    setBusy(false);
    setError(null);
    setDone(null);
  }, [request]);

  const confirm = async () => {
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      setDone(await request.run(option));
    } catch {
      setError('La suppression a échoué. Réessayez dans un instant ; si cela persiste, vérifiez que vous êtes toujours administrateur de la plateforme.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-md">
        {request && done === null && (
          <>
            <DialogHeader>
              <span className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl bg-[hsl(var(--danger))]/10 text-[hsl(var(--danger))]">
                <Trash2 className="h-5 w-5" />
              </span>
              <DialogTitle>{request.title}</DialogTitle>
              <DialogDescription>{request.description}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
            {request.options && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-foreground">Période à supprimer</p>
                <Tabs value={option} onValueChange={setOption}>
                  <TabsList variant="segmented" className="flex w-full">
                    {request.options.map((item) => (
                      <TabsTrigger key={item.value} value={item.value} className="flex-1">
                        {item.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>
            )}
            <dl className="divide-y divide-border rounded-lg border border-border bg-surface-2 text-xs">
              {[{ label: 'Workspace', value: currentWorkspace?.name ?? '—' }, ...request.scope].map((row) => (
                <div key={row.label} className="flex items-start justify-between gap-4 px-3 py-2">
                  <dt className="shrink-0 text-muted-foreground">{row.label}</dt>
                  <dd className="text-right font-medium text-foreground">{row.value}</dd>
                </div>
              ))}
            </dl>
            <p className="rounded-lg border border-[hsl(var(--danger))]/25 bg-[hsl(var(--danger))]/5 px-3 py-2 text-xs leading-relaxed text-foreground/90">
              Action définitive : les entrées supprimées ne pourront pas être récupérées. Pensez à les exporter avant si vous pourriez en avoir besoin.
            </p>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            </div>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
                Annuler
              </Button>
              <Button type="button" variant="destructive" onClick={() => void confirm()} disabled={busy} className="gap-1.5">
                {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                {busy ? 'Suppression…' : request.confirmLabel}
              </Button>
            </DialogFooter>
          </>
        )}
        {request && done !== null && (
          <>
            <DialogHeader>
              <span className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl bg-[hsl(var(--ok))]/10 text-[hsl(var(--ok))]">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <DialogTitle>{done === 0 ? 'Rien à supprimer' : `${done.toLocaleString('fr-FR')} entrée${done > 1 ? 's' : ''} supprimée${done > 1 ? 's' : ''}`}</DialogTitle>
              <DialogDescription>
                {done === 0 ? 'Aucune entrée ne correspondait à cette sélection : le journal est inchangé.' : 'Le journal a été mis à jour.'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" onClick={onClose}>
                Fermer
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Toolbar entry point, only rendered for platform admins.
function PurgeButton({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="secondary"
          size="icon"
          onClick={onClick}
          aria-label="Supprimer des entrées du journal"
          className="shrink-0 text-[hsl(var(--danger))] hover:bg-[hsl(var(--danger))]/10 hover:text-[hsl(var(--danger))]"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Supprimer des entrées · réservé aux administrateurs de la plateforme</TooltipContent>
    </Tooltip>
  );
}


function ActionsTab() {
  const params = useParams<{ workspace: string }>();
  const slug = params.workspace;
  const { data: facets } = usePolling('audit-facets', api.auditLogs.facets, { intervalMs: 120000, redirectOnError: false });
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [actor, setActor] = useState(ANY);
  const [resourceType, setResourceType] = useState(ANY);
  const [period, setPeriod] = useState<Period>('7d');
  const { isPlatformAdmin } = useWorkspace();
  const [purge, setPurge] = useState<PurgeRequest | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const filters = useMemo(
    () => ({
      q: debouncedQuery || undefined,
      actorUserId: actor === ANY ? undefined : actor,
      resourceType: resourceType === ANY ? undefined : resourceType,
      from: periodStart(period),
    }),
    [debouncedQuery, actor, resourceType, period],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api.auditLogs
      .list({ ...filters, limit: 100 })
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        setRefs(result.refs ?? {});
        setCursor(result.nextCursor);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters, reloadKey]);

  useLiveSocket((message) => {
    if (message.type !== 'audit.new') return;
    const entry = message.payload as AuditLogItem;
    if (filters.actorUserId && entry.actorUserId !== filters.actorUserId) return;
    if (filters.resourceType && entry.resourceType !== filters.resourceType) return;
    if (filters.q) return; // can't evaluate the server-side search locally
    setItems((prev) => (prev.some((item) => item.id === entry.id) ? prev : [entry, ...prev]));
  });

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const result = await api.auditLogs.list({ ...filters, before: cursor, limit: 100 });
      setItems((prev) => [...prev, ...result.items]);
      setRefs((prev) => ({ ...prev, ...(result.refs ?? {}) }));
      setCursor(result.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  // Reaching the end of the list loads the next page by itself; the button
  // stays for keyboard users and as a visible "there is more".
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || loadingMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMoreRef.current();
    }, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [cursor, loadingMore]);

  const openExport = (format: 'csv' | 'json') => {
    const from = periodStart(period) ?? new Date(0).toISOString();
    return api.auditLogs.download({ from, to: new Date().toISOString(), format });
  };

  const days = useMemo(() => {
    const groups: Array<{ label: string; entries: AuditLogItem[] }> = [];
    for (const entry of items) {
      const label = dayLabel(entry.createdAt);
      const last = groups[groups.length - 1];
      if (last?.label === label) last.entries.push(entry);
      else groups.push({ label, entries: [entry] });
    }
    return groups;
  }, [items]);

  const filtersActive = query.trim() !== '' || actor !== ANY || resourceType !== ANY;

  const askDeleteEntry = (entry: AuditLogItem) =>
    setPurge({
      title: 'Supprimer cette entrée ?',
      description: 'Elle disparaîtra du journal de ce workspace. Sa suppression, elle, y restera tracée.',
      scope: [
        { label: 'Date', value: new Date(entry.createdAt).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' }) },
        { label: 'Action', value: `${entry.actor?.name ?? 'Système'} ${auditVerb(entry.action, entry.resourceType).verb}` },
      ],
      confirmLabel: 'Supprimer l’entrée',
      run: async () => {
        const { deleted } = await api.auditLogs.remove({ ids: [entry.id] });
        setItems((prev) => prev.filter((item) => item.id !== entry.id));
        return deleted;
      },
    });

  const askDeleteFiltered = () =>
    setPurge({
      title: filtersActive ? 'Supprimer les actions filtrées ?' : 'Supprimer les actions de la période ?',
      description: 'Toutes les actions correspondant à la sélection ci-dessous seront retirées du journal, y compris celles pas encore chargées à l’écran. La suppression, elle, y restera tracée.',
      scope: [
        { label: 'Période', value: PERIODS[period].label },
        { label: 'Personne', value: actor === ANY ? 'Toutes' : (facets?.actors.find((item) => item.id === actor)?.name ?? '—') },
        { label: 'Éléments', value: resourceType === ANY ? 'Tous' : (RESOURCE_FILTER_LABEL[resourceType] ?? resourceType) },
        ...(filters.q ? [{ label: 'Recherche', value: `« ${filters.q} »` }] : []),
        { label: 'Entrées', value: cursor ? `${items.length} affichées, et plus` : `${items.length}` },
      ],
      confirmLabel: 'Supprimer définitivement',
      run: async () => {
        const { deleted } = await api.auditLogs.remove({ from: filters.from, actorUserId: filters.actorUserId, resourceType: filters.resourceType, q: filters.q });
        setReloadKey((key) => key + 1);
        return deleted;
      },
    });

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 lg:px-5">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-8 pl-8" placeholder="Rechercher une personne, une action, une ressource…" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <Select value={actor} onValueChange={setActor}>
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Toutes les personnes</SelectItem>
            {(facets?.actors ?? []).map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={resourceType} onValueChange={setResourceType}>
          <SelectTrigger className="h-8 w-48 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Tous les éléments</SelectItem>
            {(facets?.resourceTypes ?? []).map((type) => (
              <SelectItem key={type} value={type}>
                {RESOURCE_FILTER_LABEL[type] ?? type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={period} onValueChange={(value) => setPeriod(value as Period)}>
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(PERIODS) as Period[]).map((key) => (
              <SelectItem key={key} value={key}>
                {PERIODS[key].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtersActive && (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1"
            onClick={() => {
              setQuery('');
              setActor(ANY);
              setResourceType(ANY);
            }}
          >
            <X className="h-3.5 w-3.5" />
            Effacer
          </Button>
        )}
        <ExportMenu onExport={openExport} hint={`Toutes les actions · ${PERIODS[period].label.toLowerCase()}`} />
        {isPlatformAdmin && items.length > 0 && <PurgeButton onClick={askDeleteFiltered} />}
      </div>
      <PurgeDialog request={purge} onClose={() => setPurge(null)} />

      {loading ? (
        <div className="p-4 lg:p-5">
          <ListSkeleton rows={6} />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
          <History className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">Aucune action sur cette période</p>
          <p className="text-xs text-muted-foreground">
            {filtersActive ? 'Essayez d’élargir la recherche ou la période.' : 'Les modifications faites sur la flotte apparaîtront ici, en direct.'}
          </p>
          <OlderPeriodFooter period={period} onWiden={setPeriod} bare />
        </div>
      ) : (
        <div className="animate-fade-in">
          {days.map((day) => (
            <section key={day.label}>
              <h3 className="sticky top-0 z-10 border-b border-border bg-surface-1/95 px-4 py-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur lg:px-5">
                {day.label}
                <span className="ml-2 font-normal normal-case tracking-normal">
                  {day.entries.length} action{day.entries.length > 1 ? 's' : ''}
                </span>
              </h3>
              <ul className="divide-y divide-border/60">
                {day.entries.map((entry) => (
                  <AuditRow key={entry.id} entry={entry} refs={refs} slug={slug} onDelete={isPlatformAdmin ? () => askDeleteEntry(entry) : undefined} />
                ))}
              </ul>
            </section>
          ))}
          {cursor ? (
            <div ref={sentinelRef} className="flex justify-center border-t border-border py-3">
              <Button variant="secondary" size="sm" onClick={() => void loadMore()} disabled={loadingMore} className="gap-1.5">
                {loadingMore && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                {loadingMore ? 'Chargement…' : 'Afficher les actions plus anciennes'}
              </Button>
            </div>
          ) : (
            <OlderPeriodFooter period={period} onWiden={setPeriod} />
          )}
        </div>
      )}
    </Card>
  );
}

// Shown once a period has been read to its start: one click goes further back.
function OlderPeriodFooter({ period, onWiden, bare }: { period: Period; onWiden: (period: Period) => void; bare?: boolean }) {
  const order: Period[] = ['24h', '7d', '30d', 'all'];
  const wider = order.slice(order.indexOf(period) + 1);
  return (
    <div className={cn('flex flex-wrap items-center justify-center gap-2 py-3 text-xs text-muted-foreground', !bare && 'border-t border-border')}>
      {wider.length === 0 ? (
        <span>Début du journal : toutes les actions sont affichées.</span>
      ) : (
        <>
          <span>{bare ? 'Remonter plus loin :' : `Début de la période (${PERIODS[period].label.toLowerCase()}). Remonter plus loin :`}</span>
          {wider.map((option) => (
            <Button key={option} variant="secondary" size="sm" className="h-7 text-2xs" onClick={() => onWiden(option)}>
              {PERIODS[option].label}
            </Button>
          ))}
        </>
      )}
    </div>
  );
}

const MAX_LIVE_LINES = 500;

const LEVELS: Record<string, { label: string; badge: string; text: string }> = {
  critical: { label: 'CRIT', badge: 'bg-[hsl(var(--danger))]/20 text-[hsl(var(--danger))]', text: 'text-[hsl(var(--danger))] font-semibold' },
  error: { label: 'ERR', badge: 'bg-[hsl(var(--danger))]/15 text-[hsl(var(--danger))]', text: 'text-[hsl(var(--danger))]' },
  warning: { label: 'WARN', badge: 'bg-[hsl(var(--warn))]/15 text-[hsl(var(--warn))]', text: 'text-[hsl(var(--warn))]' },
  info: { label: 'INFO', badge: 'bg-surface-3 text-muted-foreground', text: 'text-foreground/85' },
};

const OLDER_PAGE = 200;
// Agent lines are pruned after the workspace's retention (Settings), 14 days by default.
const DEFAULT_AGENT_LOG_RETENTION_DAYS = 14;
const JUMPS: Array<{ value: string; label: string; hours: number }> = [
  { value: '1h', label: 'Il y a 1 h', hours: 1 },
  { value: '6h', label: 'Il y a 6 h', hours: 6 },
  { value: '24h', label: 'Il y a 24 h', hours: 24 },
  { value: '3d', label: 'Il y a 3 jours', hours: 72 },
  { value: '7d', label: 'Il y a 7 jours', hours: 168 },
  { value: '14d', label: 'Il y a 14 jours', hours: 336 },
];
const LIVE = 'live';

function AgentsTab() {
  const { data: nodes = [] } = usePolling('nodes', api.nodes.list, { intervalMs: 30000 });
  const { currentWorkspaceId } = useWorkspace();
  const { data: workspaces } = usePolling('workspaces', api.workspaces.list, { intervalMs: 60000, redirectOnError: false });
  const retentionDays = workspaces?.find((item) => item.id === currentWorkspaceId)?.agentLogRetentionDays ?? DEFAULT_AGENT_LOG_RETENTION_DAYS;
  const [nodeFilter, setNodeFilter] = useState('all');
  const [levelFilter, setLevelFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [jump, setJump] = useState(LIVE);
  const { isPlatformAdmin } = useWorkspace();
  const [purge, setPurge] = useState<PurgeRequest | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [lines, setLines] = useState<AgentLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);
  const [paused, setPaused] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingLinesRef = useRef<AgentLogItem[]>([]);
  const liveBufferRef = useRef<AgentLogItem[]>([]);
  // Set right before older lines are prepended: the height they add is
  // given back to scrollTop so the line being read doesn't move.
  const prependFromHeightRef = useRef<number | null>(null);

  const anchored = jump !== LIVE;
  const nodeName = (nodeId: string) => shortHostname(nodes.find((node) => node.id === nodeId)?.name ?? nodeId.slice(0, 8));
  const sortedNodes = useMemo(() => [...nodes].sort((a, b) => a.name.localeCompare(b.name)), [nodes]);
  const baseQuery = () => ({ nodeId: nodeFilter === 'all' ? undefined : nodeFilter, level: levelFilter === 'all' ? undefined : levelFilter });

  useEffect(() => {
    let cancelled = false;
    const hours = JUMPS.find((option) => option.value === jump)?.hours;
    setLoading(true);
    setPaused(hours !== undefined);
    setPendingCount(0);
    setHasOlder(true);
    pendingLinesRef.current = [];
    liveBufferRef.current = [];
    void api.agentLogs
      .list({ ...baseQuery(), before: hours ? new Date(Date.now() - hours * 3600e3).toISOString() : undefined, limit: OLDER_PAGE })
      .then((result) => {
        if (cancelled) return;
        setLines(result.items.slice().reverse());
        setHasOlder(result.items.length === OLDER_PAGE);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeFilter, levelFilter, jump, reloadKey]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (prependFromHeightRef.current !== null) {
      el.scrollTop += el.scrollHeight - prependFromHeightRef.current;
      prependFromHeightRef.current = null;
      return;
    }
    if (!paused) el.scrollTop = el.scrollHeight;
  }, [lines, paused, loading]);

  useLiveSocket((message) => {
    if (message.type !== 'agent-log.new') return;
    if (anchored) return; // reading the past: "Revenir au direct" reloads the tail
    const entry = message.payload as AgentLogItem;
    if (nodeFilter !== 'all' && entry.nodeId !== nodeFilter) return;
    if (levelFilter !== 'all' && entry.level !== levelFilter) return;
    if (paused) {
      pendingLinesRef.current.push(entry);
      setPendingCount((count) => count + 1);
      return;
    }
    liveBufferRef.current.push(entry);
  });

  // Bursts of agent activity can push many lines within milliseconds; batching
  // into one state update per 250ms window avoids a full 500-row re-render per line.
  // Only the live tail is trimmed: someone scrolled up into history is paused,
  // so what they loaded stays until they come back down.
  useEffect(() => {
    const flush = setInterval(() => {
      if (liveBufferRef.current.length === 0) return;
      const batch = liveBufferRef.current;
      liveBufferRef.current = [];
      setLines((prev) => {
        const next = [...prev, ...batch];
        if (next.length <= MAX_LIVE_LINES) return next;
        setHasOlder(true);
        return next.slice(-MAX_LIVE_LINES);
      });
    }, 250);
    return () => clearInterval(flush);
  }, []);

  const resume = () => {
    if (anchored) {
      setJump(LIVE);
      return;
    }
    setPaused(false);
    const pending = pendingLinesRef.current;
    if (pending.length > 0) {
      pendingLinesRef.current = [];
      setLines((prev) => [...prev, ...pending]);
    }
    setPendingCount(0);
  };

  const loadOlder = async () => {
    if (lines.length === 0 || loadingOlder || !hasOlder) return;
    setLoadingOlder(true);
    setPaused(true);
    try {
      const result = await api.agentLogs.list({ ...baseQuery(), before: lines[0].createdAt, limit: OLDER_PAGE });
      prependFromHeightRef.current = scrollRef.current?.scrollHeight ?? null;
      setLines((prev) => [...result.items.slice().reverse(), ...prev]);
      setHasOlder(result.items.length === OLDER_PAGE);
    } finally {
      setLoadingOlder(false);
    }
  };

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop < 80) void loadOlder();
    if (anchored) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom) {
      if (paused) resume();
    } else if (!paused) {
      setPaused(true);
    }
  };

  const [exportError, setExportError] = useState<string | null>(null);
  const openExport = (format: 'csv' | 'json', hours: number) => {
    const from = new Date(Date.now() - hours * 3600e3).toISOString();
    setExportError(null);
    api.agentLogs
      .download({ from, to: new Date().toISOString(), format, nodeId: nodeFilter === 'all' ? undefined : nodeFilter })
      .catch((caught: unknown) => setExportError(caught instanceof Error ? caught.message : 'L’export a échoué.'));
  };

  const LEVEL_FILTER_LABEL: Record<string, string> = { all: 'Tous', error: 'Erreurs', warning: 'Avertissements', info: 'Infos' };
  const askPurge = () =>
    setPurge({
      title: 'Supprimer des logs d’agents ?',
      description: 'Les lignes correspondant aux filtres actuels seront supprimées pour la période choisie.',
      scope: [
        { label: 'Nœud', value: nodeFilter === 'all' ? 'Tous les nœuds' : nodeName(nodeFilter) },
        { label: 'Niveau', value: LEVEL_FILTER_LABEL[levelFilter] ?? levelFilter },
      ],
      options: [
        { label: '1 h', value: '1' },
        { label: '24 h', value: '24' },
        { label: '7 jours', value: String(24 * 7) },
        { label: 'Tout', value: 'all' },
      ],
      confirmLabel: 'Supprimer définitivement',
      run: async (option) => {
        const { deleted } = await api.agentLogs.remove({
          ...baseQuery(),
          from: option && option !== 'all' ? new Date(Date.now() - Number(option) * 3600e3).toISOString() : undefined,
        });
        setReloadKey((key) => key + 1);
        return deleted;
      },
    });

  const needle = search.trim().toLowerCase();
  const shown = needle ? lines.filter((line) => line.message.toLowerCase().includes(needle)) : lines;
  const oldest = lines[0]?.createdAt;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 lg:px-5">
        <Select value={nodeFilter} onValueChange={setNodeFilter}>
          <SelectTrigger className="h-8 w-52 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les nœuds</SelectItem>
            {sortedNodes.map((node) => (
              <SelectItem key={node.id} value={node.id}>
                {shortHostname(node.name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Tabs value={levelFilter} onValueChange={setLevelFilter}>
          <TabsList variant="segmented" aria-label="Niveau">
            <TabsTrigger value="all">Tout</TabsTrigger>
            <TabsTrigger value="error">Erreurs</TabsTrigger>
            <TabsTrigger value="warning">Avertissements</TabsTrigger>
            <TabsTrigger value="info">Infos</TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={jump} onValueChange={setJump}>
          <SelectTrigger className="h-8 w-40 justify-start gap-1.5 text-xs [&>span]:flex-1 [&>span]:text-left" aria-label="Remonter dans l’historique">
            <CalendarClock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={LIVE}>En direct</SelectItem>
            {JUMPS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-8 pl-8" placeholder="Filtrer les lignes chargées…" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        {exportError && (
          <span role="alert" className="text-xs text-[hsl(var(--danger))]">
            {exportError}
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm" className="gap-1.5">
              <Download className="h-3.5 w-3.5" />
              Exporter
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="text-2xs font-normal text-muted-foreground">
              {nodeFilter === 'all' ? 'Tous les nœuds' : nodeName(nodeFilter)} · CSV
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={() => openExport('csv', 1)}>Dernière heure</DropdownMenuItem>
            <DropdownMenuItem onClick={() => openExport('csv', 24)}>Dernières 24 h</DropdownMenuItem>
            <DropdownMenuItem onClick={() => openExport('csv', 24 * 7)}>7 derniers jours</DropdownMenuItem>
            <DropdownMenuItem onClick={() => openExport('csv', 24 * retentionDays)}>{retentionDays} derniers jours</DropdownMenuItem>
            <DropdownMenuLabel className="text-2xs font-normal text-muted-foreground">JSON</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => openExport('json', 24)}>Dernières 24 h</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {isPlatformAdmin && <PurgeButton onClick={askPurge} />}
      </div>
      <PurgeDialog request={purge} onClose={() => setPurge(null)} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface-2/40 px-4 py-2 text-2xs lg:px-5">
        {loading ? (
          <span className="text-muted-foreground">Chargement…</span>
        ) : anchored ? (
          <span className="flex items-center gap-1.5 text-primary">
            <History className="h-3.5 w-3.5" />
            Historique jusqu’au {new Date(Date.now() - (JUMPS.find((option) => option.value === jump)?.hours ?? 0) * 3600e3).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </span>
        ) : paused ? (
          <span className="flex items-center gap-1.5 text-[hsl(var(--warn))]">
            <PauseCircle className="h-3.5 w-3.5" />
            En pause{pendingCount > 0 ? ` · ${pendingCount} nouvelle${pendingCount > 1 ? 's' : ''} ligne${pendingCount > 1 ? 's' : ''}` : ''}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-[hsl(var(--ok))]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[hsl(var(--ok))] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[hsl(var(--ok))]" />
            </span>
            En direct
          </span>
        )}
        <span className="text-muted-foreground">
          {shown.length} ligne{shown.length > 1 ? 's' : ''}
          {needle ? ` sur ${lines.length}` : ''}
          {oldest && ` · depuis ${new Date(oldest).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
        </span>
        <span className="flex-1" />
        {paused || anchored ? (
          <Button size="sm" onClick={resume} className="h-7 gap-1.5 text-2xs">
            <PlayCircle className="h-3.5 w-3.5" />
            Revenir au direct
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setPaused(true)} className="h-7 gap-1.5 text-2xs">
            <PauseCircle className="h-3.5 w-3.5" />
            Pause
          </Button>
        )}
      </div>

      {loading ? (
        <div className="p-4">
          <ListSkeleton rows={8} />
        </div>
      ) : (
        <div ref={scrollRef} onScroll={handleScroll} className="h-[min(560px,65vh)] overflow-y-auto bg-background/60 pb-2 font-mono text-xs leading-relaxed">
          {lines.length > 0 && (
            <div className="flex justify-center border-b border-border/60 px-4 py-2 font-sans">
              {hasOlder ? (
                <Button variant="ghost" size="sm" onClick={() => void loadOlder()} disabled={loadingOlder} className="h-7 gap-1.5 text-2xs text-muted-foreground">
                  {loadingOlder ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
                  {loadingOlder ? 'Chargement de l’historique…' : `Charger ${OLDER_PAGE} lignes plus anciennes`}
                </Button>
              ) : (
                <span className="py-1 text-2xs text-muted-foreground">
                  Début de l’historique — les logs des agents sont conservés {retentionDays} jours.
                </span>
              )}
            </div>
          )}
          {shown.length === 0 && (
            <p className="flex flex-col items-center gap-2 py-16 text-center font-sans text-sm text-muted-foreground">
              <Terminal className="h-5 w-5" />
              {needle ? 'Aucune ligne chargée ne contient ce texte.' : anchored ? 'Aucun log d’agent avant ce moment pour ces filtres.' : 'Aucun log d’agent pour ces filtres.'}
            </p>
          )}
          {shown.map((line, index) => {
            const level = LEVELS[line.level] ?? LEVELS.info;
            const previous = shown[index - 1];
            const newDay = !previous || new Date(previous.createdAt).toDateString() !== new Date(line.createdAt).toDateString();
            return (
              <Fragment key={line.id}>
                {newDay && (
                  <div className="sticky top-0 z-10 border-y border-border/60 bg-surface-1/95 px-4 py-1 font-sans text-2xs font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur lg:px-5">
                    {dayLabel(line.createdAt)}
                  </div>
                )}
                <div className="flex items-baseline gap-2 px-4 py-0.5 hover:bg-surface-2/60 lg:px-5">
                  <span className="shrink-0 tabular-nums text-muted-foreground/80" title={new Date(line.createdAt).toLocaleString('fr-FR')}>
                    {new Date(line.createdAt).toLocaleTimeString('fr-FR', { hour12: false })}
                  </span>
                  <span className={cn('w-11 shrink-0 rounded px-1 text-center text-[10px] font-semibold leading-4', level.badge)}>{level.label}</span>
                  {nodeFilter === 'all' && <span className="w-24 shrink-0 truncate text-primary/90">{nodeName(line.nodeId)}</span>}
                  <span className={cn('min-w-0 whitespace-pre-wrap break-words', level.text)}>{line.message}</span>
                </div>
              </Fragment>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export default function LogsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Journal"
        description="Qui a fait quoi sur la flotte, et ce que racontent les agents, en direct."
      />

      <Tabs defaultValue="actions" className="space-y-4">
        <TabsList>
          <TabsTrigger value="actions" className="gap-1.5">
            <History className="h-3.5 w-3.5" />
            Actions de l’équipe
          </TabsTrigger>
          <TabsTrigger value="agents" className="gap-1.5">
            <Terminal className="h-3.5 w-3.5" />
            Logs des agents
          </TabsTrigger>
        </TabsList>

        <TabsContent value="actions">
          <ActionsTab />
        </TabsContent>
        <TabsContent value="agents">
          <AgentsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
