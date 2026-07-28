'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { Download, History, PauseCircle, PlayCircle, ScrollText, Search, Server } from 'lucide-react';
import Link from 'next/link';
import { api, AgentLogItem, AuditLogItem } from '../../../lib/api';
import { usePolling } from '../../../lib/hooks/usePolling';
import { useLiveSocket } from '../../../lib/hooks/useLiveSocket';
import { DashboardLayout } from '../../../components/DashboardLayout';
import { PageHeader } from '../../../components/PageHeader';
import { Callout } from '../../../components/Callout';
import { SectionLabel } from '../../../components/SectionLabel';
import { Badge } from '../../../components/ui';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import { ListSkeleton } from '../../../components/ui/skeleton';

// resourceType -> where an audit entry's affected resource can be reviewed.
// notification_channel and share_client have no dedicated page yet.
const RESOURCE_ROUTES: Record<string, string> = {
  node: '/dashboard/infrastructure',
  migration: '/dashboard/migrations',
  mount: '/dashboard/mounts',
  share: '/dashboard/mounts',
  pool: '/dashboard/storage',
  pool_member: '/dashboard/storage',
  sync_job: '/dashboard/replication',
  sync_job_run: '/dashboard/replication',
  alert: '/dashboard/alerts',
  alert_rule: '/dashboard/alerts',
};

const LEVEL_TEXT_CLASS: Record<string, string> = {
  info: 'text-zinc-300',
  warning: 'text-amber-400',
  error: 'text-rose-400',
  critical: 'text-red-300 font-semibold',
};

const LEVEL_BADGE_TYPE: Record<string, 'info' | 'warning' | 'error' | 'critical'> = {
  info: 'info',
  warning: 'warning',
  error: 'error',
  critical: 'critical',
};

const LEVEL_LABEL: Record<string, string> = {
  info: 'INFO',
  warning: 'WARN',
  error: 'ERROR',
  critical: 'CRIT',
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('fr-FR');
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour12: false });
}

type AuditFilters = {
  q: string;
  actorUserId: string;
  action: string;
  resourceType: string;
  from: string;
};

function matchesAuditFilters(entry: AuditLogItem, filters: AuditFilters) {
  if (filters.actorUserId && entry.actorUserId !== filters.actorUserId) return false;
  if (filters.action && entry.action !== filters.action) return false;
  if (filters.resourceType && entry.resourceType !== filters.resourceType) return false;
  if (filters.q) {
    const haystack = `${entry.action} ${entry.resourceType} ${entry.resourceId ?? ''}`.toLowerCase();
    if (!haystack.includes(filters.q.toLowerCase())) return false;
  }
  return true;
}

function ActionsTab() {
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<AuditFilters>({ q: '', actorUserId: '', action: '', resourceType: '', from: '' });
  const [exportTo, setExportTo] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api.auditLogs
      .list({
        q: filters.q || undefined,
        actorUserId: filters.actorUserId || undefined,
        action: filters.action || undefined,
        resourceType: filters.resourceType || undefined,
        from: filters.from || undefined,
        limit: 100,
      })
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        setCursor(result.nextCursor);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters.q, filters.actorUserId, filters.action, filters.resourceType, filters.from]);

  useLiveSocket((message) => {
    if (message.type !== 'audit.new') return;
    const entry = message.payload as AuditLogItem;
    if (!matchesAuditFilters(entry, filters)) return;
    setItems((prev) => [entry, ...prev]);
  });

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const result = await api.auditLogs.list({
        before: cursor,
        q: filters.q || undefined,
        actorUserId: filters.actorUserId || undefined,
        action: filters.action || undefined,
        resourceType: filters.resourceType || undefined,
        from: filters.from || undefined,
        limit: 100,
      });
      setItems((prev) => [...prev, ...result.items]);
      setCursor(result.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  const openExport = (format: 'csv' | 'json') => {
    const to = exportTo || new Date().toISOString();
    const from = filters.from || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    window.open(api.auditLogs.exportUrl({ from, to, format }), '_blank');
  };

  return (
    <Card className="border-white/[0.08] transition-colors hover:border-white/[0.14]">
      <CardHeader className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <History className="h-5 w-5 text-violet-400" />
            <CardTitle className="text-base">Journal d&apos;actions</CardTitle>
            {!loading && (
              <Badge label={`${items.length} entrée${items.length > 1 ? 's' : ''}`} type="info" />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-xs text-muted-foreground">Export jusqu&apos;au</Label>
            <Input type="date" className="w-40" value={exportTo} onChange={(e) => setExportTo(e.target.value)} />
            <Button variant="secondary" size="sm" onClick={() => openExport('csv')} className="gap-2">
              <Download className="h-3.5 w-3.5" />
              CSV
            </Button>
            <Button variant="secondary" size="sm" onClick={() => openExport('json')} className="gap-2">
              <Download className="h-3.5 w-3.5" />
              JSON
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 md:grid-cols-2 xl:grid-cols-5">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Recherche</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="action, ressource…"
                value={filters.q}
                onChange={(e) => setFilters((prev) => ({ ...prev, q: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Acteur (ID)</Label>
            <Input
              value={filters.actorUserId}
              onChange={(e) => setFilters((prev) => ({ ...prev, actorUserId: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Action</Label>
            <Input
              placeholder="ex: node.create"
              value={filters.action}
              onChange={(e) => setFilters((prev) => ({ ...prev, action: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Ressource</Label>
            <Input
              placeholder="ex: migration"
              value={filters.resourceType}
              onChange={(e) => setFilters((prev) => ({ ...prev, resourceType: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Depuis</Label>
            <Input
              type="date"
              value={filters.from}
              onChange={(e) => setFilters((prev) => ({ ...prev, from: e.target.value }))}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <ListSkeleton rows={6} />
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Aucune action trouvée.</p>
        ) : (
          <div className="animate-fade-in overflow-hidden rounded-xl border border-white/[0.06]">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Acteur</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Ressource</TableHead>
                    <TableHead className="text-right">Détails</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((entry) => {
                    const route = RESOURCE_ROUTES[entry.resourceType];
                    return (
                      <Fragment key={entry.id}>
                        <TableRow>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                            {formatDateTime(entry.createdAt)}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{entry.actorUserId ?? 'système'}</TableCell>
                          <TableCell>
                            <Badge label={entry.action} type="info" />
                          </TableCell>
                          <TableCell>
                            {route ? (
                              <Link href={route} className="text-violet-300 underline-offset-2 hover:underline">
                                {entry.resourceType}
                                {entry.resourceId ? ` · ${entry.resourceId.slice(0, 8)}` : ''}
                              </Link>
                            ) : (
                              <span>
                                {entry.resourceType}
                                {entry.resourceId ? ` · ${entry.resourceId.slice(0, 8)}` : ''}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {entry.details ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setExpandedId((current) => (current === entry.id ? null : entry.id))}
                              >
                                {expandedId === entry.id ? 'Masquer' : 'Voir'}
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                        {expandedId === entry.id && (
                          <TableRow>
                            <TableCell colSpan={5} className="bg-white/[0.02]">
                              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-zinc-300">
                                {JSON.stringify(entry.details, null, 2)}
                              </pre>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {cursor && (
              <div className="flex justify-center border-t border-white/[0.06] bg-white/[0.02] py-3">
                <Button variant="secondary" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
                  {loadingMore ? 'Chargement…' : 'Charger plus'}
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const MAX_LIVE_LINES = 500;

function AgentsTab() {
  const { data: nodes = [] } = usePolling('nodes', api.nodes.list);
  const [nodeFilter, setNodeFilter] = useState('all');
  const [levelFilter, setLevelFilter] = useState('all');
  const [lines, setLines] = useState<AgentLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [paused, setPaused] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pendingLinesRef = useRef<AgentLogItem[]>([]);

  const nodeName = (nodeId: string) => nodes.find((node) => node.id === nodeId)?.name ?? nodeId;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPaused(false);
    setPendingCount(0);
    pendingLinesRef.current = [];
    void api.agentLogs
      .list({
        nodeId: nodeFilter === 'all' ? undefined : nodeFilter,
        level: levelFilter === 'all' ? undefined : levelFilter,
        limit: 200,
      })
      .then((result) => {
        if (cancelled) return;
        setLines(result.items.slice().reverse());
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nodeFilter, levelFilter]);

  useEffect(() => {
    if (paused) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, paused]);

  useLiveSocket((message) => {
    if (message.type !== 'agent-log.new') return;
    const entry = message.payload as AgentLogItem;
    if (nodeFilter !== 'all' && entry.nodeId !== nodeFilter) return;
    if (levelFilter !== 'all' && entry.level !== levelFilter) return;
    if (paused) {
      pendingLinesRef.current.push(entry);
      setPendingCount((count) => count + 1);
      return;
    }
    setLines((prev) => [...prev, entry].slice(-MAX_LIVE_LINES));
  });

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom) {
      if (paused) resume();
    } else if (!paused) {
      setPaused(true);
    }
  };

  const resume = () => {
    setPaused(false);
    const pending = pendingLinesRef.current;
    if (pending.length > 0) {
      pendingLinesRef.current = [];
      setLines((prev) => [...prev, ...pending].slice(-MAX_LIVE_LINES));
    }
    setPendingCount(0);
  };

  const loadOlder = async () => {
    if (lines.length === 0) return;
    setLoadingOlder(true);
    try {
      const result = await api.agentLogs.list({
        nodeId: nodeFilter === 'all' ? undefined : nodeFilter,
        before: lines[0].createdAt,
        limit: 200,
      });
      setLines((prev) => [...result.items.slice().reverse(), ...prev]);
    } finally {
      setLoadingOlder(false);
    }
  };

  const openExport = (format: 'csv' | 'json') => {
    const to = exportTo || new Date().toISOString();
    const from = exportFrom || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    window.open(
      api.agentLogs.exportUrl({ from, to, format, nodeId: nodeFilter === 'all' ? undefined : nodeFilter }),
      '_blank',
    );
  };

  return (
    <Card className="border-white/[0.08] transition-colors hover:border-white/[0.14]">
      <CardHeader className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Server className="h-5 w-5 text-violet-400" />
            <CardTitle className="text-base">Logs agents</CardTitle>
            {!loading && !paused && (
              <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                En direct
              </span>
            )}
            {!loading && <Badge label={`${lines.length} lignes`} type="info" />}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => openExport('csv')} className="gap-2">
              <Download className="h-3.5 w-3.5" />
              CSV
            </Button>
            <Button variant="secondary" size="sm" onClick={() => openExport('json')} className="gap-2">
              <Download className="h-3.5 w-3.5" />
              JSON
            </Button>
            {paused ? (
              <Button size="sm" onClick={resume} className="gap-2 bg-violet-600 text-white hover:bg-violet-500">
                <PlayCircle className="h-3.5 w-3.5" />
                Reprendre {pendingCount > 0 ? `(${pendingCount} nouvelles lignes)` : ''}
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => setPaused(true)} className="gap-2">
                <PauseCircle className="h-3.5 w-3.5" />
                Pause
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Nœud</Label>
            <Select value={nodeFilter} onValueChange={setNodeFilter}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les nœuds</SelectItem>
                {nodes.map((node) => (
                  <SelectItem key={node.id} value={node.id}>
                    {node.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Niveau</Label>
            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les niveaux</SelectItem>
                <SelectItem value="critical">Critique</SelectItem>
                <SelectItem value="error">Erreur</SelectItem>
                <SelectItem value="warning">Avertissement</SelectItem>
                <SelectItem value="info">Info</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Export depuis</Label>
            <Input type="date" className="w-40" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Jusqu'au</Label>
            <Input type="date" className="w-40" value={exportTo} onChange={(e) => setExportTo(e.target.value)} />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <ListSkeleton rows={6} />
        ) : (
          <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-zinc-950/70">
            <div className="flex items-center gap-3 border-b border-white/[0.06] bg-white/[0.02] px-3 py-2">
              <div className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void loadOlder()}
                disabled={loadingOlder}
                className="ml-auto h-7 text-xs"
              >
                {loadingOlder ? 'Chargement…' : "Charger l'historique"}
              </Button>
            </div>
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="h-[480px] overflow-y-auto p-3 font-mono text-xs leading-relaxed"
            >
              {lines.length === 0 && (
                <p className="py-8 text-center text-muted-foreground">Aucun log d'agent pour le moment.</p>
              )}
              {lines.map((line) => (
                <div key={line.id} className="flex items-baseline gap-2 whitespace-pre-wrap break-all py-0.5">
                  <span className="shrink-0 text-zinc-500">[{formatTime(line.createdAt)}]</span>
                  <span className="shrink-0 text-violet-300">[{nodeName(line.nodeId)}]</span>
                  <Badge
                    label={LEVEL_LABEL[line.level] ?? line.level.toUpperCase()}
                    type={LEVEL_BADGE_TYPE[line.level] ?? 'info'}
                    className="shrink-0 px-1.5 py-0 text-[10px] leading-4"
                  />
                  <span className={LEVEL_TEXT_CLASS[line.level] ?? 'text-zinc-300'}>{line.message}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function LogsPage() {
  return (
    <DashboardLayout>
      <div className="space-y-8">
        <PageHeader
          icon={ScrollText}
          title="Journal"
          description="Actions effectuées sur la flotte et logs bruts des agents, en direct."
        />

        <Callout>
          L'onglet Agents affiche les logs poussés en direct par chaque agent. Utilisez le filtre par nœud pour
          éviter que plusieurs flux se mélangent.
        </Callout>

        <Tabs defaultValue="actions" className="space-y-4">
          <TabsList>
            <TabsTrigger value="actions" className="gap-1.5">
              <History className="h-3.5 w-3.5" />
              Actions
            </TabsTrigger>
            <TabsTrigger value="agents" className="gap-1.5">
              <Server className="h-3.5 w-3.5" />
              Agents
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
    </DashboardLayout>
  );
}
