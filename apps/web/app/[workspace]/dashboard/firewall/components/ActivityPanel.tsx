'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { animate, AnimatePresence, motion } from 'framer-motion';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ArrowRight, Ban, Check, ChevronDown, Container, Eye, EyeOff, Globe2, Network, Radar, RotateCcw, Search, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, FirewallEvent, FirewallNode, FirewallRule, FirewallScope } from '@/lib/api';
import { formatRelative, shortHostname } from '@/lib/format';
import { usePolling } from '@/lib/hooks/usePolling';
import { useLiveSocket } from '@/lib/hooks/useLiveSocket';
import { cn } from '@/lib/utils';
import type { RuleDraft } from './RuleDialog';
import type { TestPreset } from './TestDialog';

const ANY = '__any__';
const PAGE = 30;
const EASE = [0.16, 1, 0.3, 1] as const;

export function useFirewallEvents(params: { hours: number; scope?: FirewallScope; verdict?: 'blocked' | 'observed'; nodeId?: string }) {
  const key = `firewall-events:${params.hours}:${params.scope ?? ''}:${params.verdict ?? ''}:${params.nodeId ?? ''}`;
  const result = usePolling(key, () => api.firewall.events(params), { intervalMs: 15000 });
  useLiveSocket((message) => {
    // firewall.changed: a flow was marked as seen (or a rule changed).
    if (message.type === 'firewall.events' || message.type === 'firewall.changed') void result.mutate();
  });
  return result;
}

/** A figure that glides to its new value instead of jumping. */
function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const controls = animate(previous.current, value, {
      duration: 0.9,
      ease: EASE,
      onUpdate: (latest) => (node.textContent = Math.round(latest).toLocaleString('fr-FR')),
    });
    previous.current = value;
    return () => controls.stop();
  }, [value]);
  return (
    <span ref={ref} className={cn('tabular', className)}>
      0
    </span>
  );
}

// Rule id the agents put on SSH attempts dropped by the brute-force limiter.
const SSH_LIMIT_ID = 'ssh-limit';

function draftsFor(event: FirewallEvent): { allow: RuleDraft; block: RuleDraft } {
  const source =
    event.scope === 'mesh'
      ? { sourceKind: event.sourceNodeId ? ('nodes' as const) : ('any' as const), sourceNodeIds: event.sourceNodeId ? [event.sourceNodeId] : [] }
      : { sourceKind: 'cidrs' as const, sourceCidrs: [event.sourceIp] };
  return {
    allow: {
      scope: event.scope,
      action: 'allow',
      ...source,
      targetKind: 'nodes',
      targetNodeIds: [event.nodeId],
      protocol: event.protocol === 'icmp' ? 'icmp' : event.protocol === 'udp' ? 'udp' : 'tcp',
      ports: event.port && event.protocol !== 'icmp' ? [String(event.port)] : [],
      // An SSH rule naming this address also exempts it from the limiter.
      name: event.ruleId === SSH_LIMIT_ID ? `SSH sans limite depuis ${event.sourceIp}` : undefined,
    },
    block: {
      scope: event.scope,
      action: 'deny',
      ...source,
      targetKind: 'any',
      protocol: 'any',
      ports: [],
      name: event.scope === 'public' ? `Bloquer ${event.sourceIp}` : undefined,
    },
  };
}

export function serviceText(event: FirewallEvent) {
  if (event.protocol === 'icmp') return 'Ping';
  const port = event.port ? `${event.port}/${event.protocol}` : event.protocol;
  return event.service ? `${event.service} · ${port}` : port;
}

function dayLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return 'Aujourd’hui';
  if (date.toDateString() === yesterday.toDateString()) return 'Hier';
  return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** One blocked (or would-be blocked) flow, readable as a sentence. */
export function EventRow({
  event,
  nodes,
  rules,
  onCreateRule,
  onTest,
  onDismiss,
  compact,
  index = 0,
  fresh,
}: {
  event: FirewallEvent;
  nodes: Map<string, FirewallNode>;
  rules: Map<string, FirewallRule>;
  onCreateRule: (draft: RuleDraft) => void;
  onTest?: (preset: TestPreset) => void;
  onDismiss?: (event: FirewallEvent, dismissed: boolean) => void;
  compact?: boolean;
  index?: number;
  fresh?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const target = nodes.get(event.nodeId);
  const sourceNode = event.sourceNodeId ? nodes.get(event.sourceNodeId) : null;
  const rule = event.ruleId ? rules.get(event.ruleId) : null;
  const sshLimited = event.ruleId === SSH_LIMIT_ID;
  const blocked = event.verdict === 'blocked';
  const drafts = draftsFor(event);
  const expandable = !compact;

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease: EASE, delay: Math.min(index, 12) * 0.025 }}
      className={cn('relative', fresh && 'animate-[fw-fresh_2.4s_ease-out]')}
    >
      {fresh && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" aria-hidden />}
      <div
        role={expandable ? 'button' : undefined}
        tabIndex={expandable ? 0 : undefined}
        aria-expanded={expandable ? open : undefined}
        onClick={() => expandable && setOpen(!open)}
        onKeyDown={(keyEvent) => expandable && keyEvent.key === 'Enter' && setOpen(!open)}
        className={cn('flex items-center gap-4 px-5 py-3.5 transition-colors', expandable && 'cursor-pointer hover:bg-surface-2/50', open && 'bg-surface-2/40')}
      >
        <span
          className={cn(
            'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
            blocked ? 'bg-[hsl(var(--danger))]/10 text-[hsl(var(--danger))]' : 'bg-[hsl(var(--info))]/10 text-[hsl(var(--info))]',
          )}
        >
          {blocked ? <Ban className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-1.5 text-sm">
            <span className={cn('truncate font-medium text-foreground', !sourceNode && 'font-mono text-[13px]')}>{sourceNode?.name ?? event.sourceIp}</span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
            <span className="truncate font-medium text-foreground">{target?.name ?? 'serveur supprimé'}</span>
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span className="rounded bg-surface-3 px-1.5 py-px font-mono text-[11px] text-foreground/80">{serviceText(event)}</span>
            <span className="inline-flex items-center gap-1">
              {event.scope === 'mesh' ? <Network className="h-3 w-3" /> : <Globe2 className="h-3 w-3" />}
              {event.scope === 'mesh' ? 'Entre serveurs' : 'Internet'}
            </span>
            {event.docker && (
              <span className="inline-flex items-center gap-1">
                <Container className="h-3 w-3" />
                conteneur
              </span>
            )}
            {event.dismissed && (
              <span className="inline-flex items-center gap-1 rounded bg-surface-3 px-1.5 py-px text-[11px]">
                <Check className="h-3 w-3" />
                Vue
              </span>
            )}
          </p>
        </div>
        <div className="hidden text-right sm:block">
          <p className="tabular text-sm font-semibold text-foreground">{event.count.toLocaleString('fr-FR')}</p>
          <p className="text-2xs text-muted-foreground">{event.count > 1 ? 'tentatives' : 'tentative'}</p>
        </div>
        <p className="w-20 shrink-0 text-right text-xs text-muted-foreground" title={new Date(event.lastSeenAt).toLocaleString('fr-FR')}>
          {formatRelative(event.lastSeenAt)}
        </p>
        {expandable && <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300', open && 'rotate-180')} />}
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="space-y-4 border-t border-border/60 bg-surface-2/40 px-5 py-4 pl-[4.5rem]">
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-2xs uppercase tracking-wider text-muted-foreground">Décision</dt>
                  <dd className="mt-0.5 text-foreground">
                    {sshLimited
                      ? 'Trop de tentatives SSH : ralentie'
                      : rule
                        ? `Règle « ${rule.name} »`
                        : blocked
                          ? 'Aucune règle ne l’autorise'
                          : 'Mode observation'}
                  </dd>
                </div>
                <div>
                  <dt className="text-2xs uppercase tracking-wider text-muted-foreground">Première tentative</dt>
                  <dd className="mt-0.5 text-foreground">{new Date(event.firstSeenAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</dd>
                </div>
                <div>
                  <dt className="text-2xs uppercase tracking-wider text-muted-foreground">Dernière tentative</dt>
                  <dd className="mt-0.5 text-foreground">{new Date(event.lastSeenAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</dd>
                </div>
              </dl>
              {event.scope === 'public' && event.sources.length > 0 && (
                <div>
                  <p className="text-2xs uppercase tracking-wider text-muted-foreground">Adresses vues</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {event.sources.map((ip) => (
                      <span key={ip} className="rounded-md border border-border bg-surface-2 px-2 py-0.5 font-mono text-xs text-foreground">
                        {ip}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button write size="sm" className="gap-1.5" onClick={() => onCreateRule(drafts.allow)}>
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {sshLimited ? 'Ne plus limiter cette adresse' : rule ? 'Autoriser malgré tout' : 'Autoriser cette connexion'}
                </Button>
                <Button write size="sm" variant="secondary" className="gap-1.5 text-[hsl(var(--danger))]" onClick={() => onCreateRule(drafts.block)}>
                  <Ban className="h-3.5 w-3.5" />
                  Bloquer cette source partout
                </Button>
                {onTest && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5"
                    onClick={() =>
                      onTest({ scope: event.scope, sourceNodeId: event.sourceNodeId ?? undefined, targetNodeId: event.nodeId, port: event.port ? String(event.port) : undefined })
                    }
                  >
                    <Radar className="h-3.5 w-3.5" />
                    Tester
                  </Button>
                )}
                {onDismiss && (
                  <Button write size="sm" variant="ghost" className="gap-1.5 sm:ml-auto" onClick={() => onDismiss(event, !event.dismissed)}>
                    {event.dismissed ? <RotateCcw className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                    {event.dismissed ? 'Remettre à examiner' : 'Vu, rien à faire'}
                  </Button>
                )}
              </div>
              {onDismiss && !event.dismissed && (
                <p className="text-xs text-muted-foreground">
                  « Vu, rien à faire » masque cette connexion, y compris quand elle revient, et ne la compte plus parmi celles à examiner. Elle reste bloquée si
                  elle l’était.
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

function TimelineChart({ hours, scope, nodeId }: { hours: number; scope?: FirewallScope; nodeId?: string }) {
  const span = Math.max(hours, 12);
  const { data } = usePolling(`firewall-timeline:${span}:${scope ?? ''}:${nodeId ?? ''}`, () => api.firewall.timeline({ hours: span, scope, nodeId }), {
    intervalMs: 30000,
  });
  const points = useMemo(() => {
    const step = span <= 48 ? 1 : span <= 168 ? 6 : 12;
    const stepMs = step * 3_600_000;
    const end = Math.floor(Date.now() / 3_600_000) * 3_600_000;
    const start = end - (Math.ceil(span / step) - 1) * stepMs;
    const buckets = new Map<number, { blocked: number; observed: number }>();
    for (let at = start; at <= end; at += stepMs) buckets.set(at, { blocked: 0, observed: 0 });
    for (const row of data ?? []) {
      const at = start + Math.floor((new Date(row.bucketStart).getTime() - start) / stepMs) * stepMs;
      const bucket = buckets.get(at);
      if (bucket) bucket[row.verdict] += row.count;
    }
    return [...buckets.entries()].map(([at, value]) => ({
      label: new Date(at).toLocaleString('fr-FR', step >= 6 ? { day: '2-digit', month: 'short', hour: '2-digit' } : { hour: '2-digit', minute: '2-digit' }),
      ...value,
    }));
  }, [data, span]);

  if (!data) return <Skeleton className="h-40 w-full" />;
  return (
    <ChartContainer
      className="h-40"
      config={{ blocked: { label: 'Bloquées', color: 'hsl(var(--danger))' }, observed: { label: 'Seraient bloquées', color: 'hsl(var(--info))' } }}
    >
      <BarChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: -24 }} barCategoryGap="18%">
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={32} />
        <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={48} />
        <ChartTooltip
          cursor={{ fill: 'hsl(var(--surface-3, 0 0% 50%) / 0.25)' }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-overlay">
                <p className="mb-1 font-medium text-foreground">{label}</p>
                {payload.map((item) => (
                  <p key={String(item.dataKey)} className="flex items-center gap-2 text-muted-foreground">
                    <span className="h-2 w-2 rounded-sm" style={{ background: item.color }} />
                    {item.dataKey === 'blocked' ? 'Bloquées' : 'Seraient bloquées'}
                    <span className="ml-auto tabular font-medium text-foreground">{Number(item.value).toLocaleString('fr-FR')}</span>
                  </p>
                ))}
              </div>
            ) : null
          }
        />
        <Bar dataKey="blocked" stackId="a" fill="var(--color-blocked)" fillOpacity={0.8} radius={[0, 0, 0, 0]} animationDuration={700} />
        <Bar dataKey="observed" stackId="a" fill="var(--color-observed)" fillOpacity={0.8} radius={[3, 3, 0, 0]} animationDuration={700} />
      </BarChart>
    </ChartContainer>
  );
}

function TopList({ title, items }: { title: string; items: Array<{ label: string; value: number; mono?: boolean }> }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <div className="space-y-2.5">
      <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">—</p>
      ) : (
        items.map((item, index) => (
          <div key={item.label} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className={cn('truncate text-foreground', item.mono && 'font-mono')}>{item.label}</span>
              <span className="tabular shrink-0 text-muted-foreground">{item.value.toLocaleString('fr-FR')}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-primary/70 to-primary"
                initial={{ width: 0 }}
                animate={{ width: `${(item.value / max) * 100}%` }}
                transition={{ duration: 0.8, ease: EASE, delay: index * 0.06 }}
              />
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export function ActivityView({
  nodes,
  rules,
  onCreateRule,
  onTest,
}: {
  nodes: FirewallNode[];
  rules: FirewallRule[];
  onCreateRule: (draft: RuleDraft) => void;
  onTest?: (preset: TestPreset) => void;
}) {
  const [scope, setScope] = useState<'all' | FirewallScope>('all');
  const [verdict, setVerdict] = useState<'all' | 'blocked' | 'observed'>('all');
  const [hours, setHours] = useState('24');
  const [nodeId, setNodeId] = useState(ANY);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const filters = {
    hours: Number(hours),
    scope: scope === 'all' ? undefined : scope,
    verdict: verdict === 'all' ? undefined : verdict,
    nodeId: nodeId === ANY ? undefined : nodeId,
  };
  const { data: events, isLoading, mutate } = useFirewallEvents(filters);
  const [showSeen, setShowSeen] = useState(false);
  const [undo, setUndo] = useState<FirewallEvent | null>(null);
  const [dismissError, setDismissError] = useState<string | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seenCount = (events ?? []).filter((event) => event.dismissed).length;
  const onDismiss = async (event: FirewallEvent, dismissed: boolean) => {
    setDismissError(null);
    // Optimistic: the row goes (or comes back) at once.
    void mutate((current) => current?.map((item) => (item.id === event.id ? { ...item, dismissed } : item)), { revalidate: false });
    clearTimeout(undoTimer.current);
    setUndo(dismissed ? event : null);
    if (dismissed) undoTimer.current = setTimeout(() => setUndo(null), 8000);
    try {
      await api.firewall.setEventDismissed(event.id, dismissed);
    } catch (caught) {
      setUndo(null);
      setDismissError(caught instanceof Error ? caught.message : 'Le changement n’a pas été enregistré.');
    }
    void mutate();
  };
  useEffect(() => setLimit(PAGE), [scope, verdict, hours, nodeId, query]);
  useEffect(() => () => clearTimeout(undoTimer.current), []);

  // Rows that appear after the first load are flagged as new for a moment.
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!events) return;
    const keys = events.map((event) => `${event.id}:${event.count}`);
    if (seen.current) {
      const added = new Set(events.filter((event, i) => !seen.current!.has(keys[i])).map((event) => event.id));
      if (added.size > 0) {
        setFresh(added);
        const timer = setTimeout(() => setFresh(new Set()), 2500);
        seen.current = new Set(keys);
        return () => clearTimeout(timer);
      }
    }
    seen.current = new Set(keys);
  }, [events]);
  useEffect(() => {
    seen.current = null;
  }, [scope, verdict, hours, nodeId]);

  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const ruleById = useMemo(() => new Map(rules.map((rule) => [rule.id, rule])), [rules]);
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const visible = (events ?? []).filter((event) => showSeen || !event.dismissed);
    if (!needle) return visible;
    return visible.filter((event) =>
      [event.sourceIp, ...event.sources, nodeById.get(event.nodeId)?.name, event.sourceNodeId ? nodeById.get(event.sourceNodeId)?.name : '', event.service, String(event.port ?? '')]
        .filter(Boolean)
        .some((value) => (value as string).toLowerCase().includes(needle)),
    );
  }, [events, query, nodeById, showSeen]);

  const sum = (kind: 'blocked' | 'observed') => shown.filter((event) => event.verdict === kind).reduce((total, event) => total + event.count, 0);
  const tally = (key: (event: FirewallEvent) => string) => {
    const map = new Map<string, number>();
    for (const event of shown) map.set(key(event), (map.get(key(event)) ?? 0) + event.count);
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  };
  const topSources = tally((event) => (event.sourceNodeId ? (nodeById.get(event.sourceNodeId)?.name ?? event.sourceIp) : event.sourceIp)).map(([label, value]) => ({
    label: shortHostname(label).length < label.length && !/^\d/.test(label) ? shortHostname(label) : label,
    value,
    mono: /^[\d.:a-f]+$/i.test(label),
  }));
  const topTargets = tally((event) => nodeById.get(event.nodeId)?.name ?? 'serveur supprimé').map(([label, value]) => ({ label: shortHostname(label), value }));

  const groups = useMemo(() => {
    const out: Array<{ day: string; events: FirewallEvent[] }> = [];
    for (const event of shown.slice(0, limit)) {
      const day = dayLabel(event.lastSeenAt);
      const last = out[out.length - 1];
      if (last?.day === day) last.events.push(event);
      else out.push({ day, events: [event] });
    }
    return out;
  }, [shown, limit]);

  const filtered = scope !== 'all' || verdict !== 'all' || nodeId !== ANY || query.trim() !== '';
  const reset = () => {
    setScope('all');
    setVerdict('all');
    setNodeId(ANY);
    setQuery('');
  };
  const withoutLogging = nodes.filter((node) => node.report && !node.report.logging && node.apply.status === 'active');
  let rowIndex = 0;

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background/80 px-3 py-2.5 backdrop-blur-md">
        <Tabs value={hours} onValueChange={setHours}>
          <TabsList variant="segmented">
            <TabsTrigger value="1">1 h</TabsTrigger>
            <TabsTrigger value="24">24 h</TabsTrigger>
            <TabsTrigger value="168">7 j</TabsTrigger>
            <TabsTrigger value="336">14 j</TabsTrigger>
          </TabsList>
        </Tabs>
        <Tabs value={scope} onValueChange={(value) => setScope(value as typeof scope)}>
          <TabsList variant="segmented">
            <TabsTrigger value="all">Tout</TabsTrigger>
            <TabsTrigger value="mesh">
              <Network className="h-3 w-3" />
              Serveurs
            </TabsTrigger>
            <TabsTrigger value="public">
              <Globe2 className="h-3 w-3" />
              Internet
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Tabs value={verdict} onValueChange={(value) => setVerdict(value as typeof verdict)}>
          <TabsList variant="segmented">
            <TabsTrigger value="all">Tous</TabsTrigger>
            <TabsTrigger value="blocked">Bloquées</TabsTrigger>
            <TabsTrigger value="observed">Observées</TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={nodeId} onValueChange={setNodeId}>
          <SelectTrigger className="h-8 w-auto min-w-[9rem] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Tous les serveurs</SelectItem>
            {nodes.map((node) => (
              <SelectItem key={node.id} value={node.id}>
                {node.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative min-w-[10rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Serveur, IP ou port…" className="h-8 pl-8" />
        </div>
        {(seenCount > 0 || showSeen) && (
          <Button variant={showSeen ? 'secondary' : 'ghost'} size="sm" className="gap-1.5" onClick={() => setShowSeen(!showSeen)} aria-pressed={showSeen}>
            {showSeen ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {showSeen ? 'Masquer les vues' : `Vues (${seenCount})`}
          </Button>
        )}
        {filtered && (
          <Button variant="ghost" size="sm" className="gap-1" onClick={reset}>
            <X className="h-3.5 w-3.5" />
            Effacer
          </Button>
        )}
        <span className="inline-flex items-center gap-1.5 pl-1 text-2xs text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[hsl(var(--ok))] opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[hsl(var(--ok))]" />
          </span>
          En direct
        </span>
      </div>

      <AnimatePresence>
        {(undo || dismissError) && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25, ease: EASE }}
            role="status"
            className={cn(
              'flex flex-wrap items-center gap-3 rounded-xl border px-4 py-2.5 text-sm',
              dismissError ? 'border-[hsl(var(--danger))]/30 bg-[hsl(var(--danger))]/10 text-foreground' : 'border-border bg-surface-2 text-foreground',
            )}
          >
            {dismissError ? (
              <span>{dismissError}</span>
            ) : (
              <>
                <Check className="h-4 w-4 text-[hsl(var(--ok))]" />
                <span className="flex-1">Connexion marquée comme vue : elle ne sera plus comptée parmi celles à examiner.</span>
                <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => undo && void onDismiss(undo, false)}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  Annuler
                </Button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="relative overflow-hidden p-5 lg:col-span-2">
          <div className="pointer-events-none absolute -left-20 -top-24 h-56 w-56 rounded-full bg-[hsl(var(--danger))]/10 blur-3xl" aria-hidden />
          <div className="relative flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Bloquées</p>
              <AnimatedNumber value={sum('blocked')} className="text-3xl font-semibold leading-tight text-[hsl(var(--danger))]" />
            </div>
            <div>
              <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Seraient bloquées</p>
              <AnimatedNumber value={sum('observed')} className="text-3xl font-semibold leading-tight text-[hsl(var(--info))]" />
            </div>
            <div>
              <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Connexions distinctes</p>
              <AnimatedNumber value={shown.length} className="text-3xl font-semibold leading-tight text-foreground" />
            </div>
          </div>
          <div className="relative mt-5">
            <TimelineChart hours={Number(hours)} scope={filters.scope} nodeId={filters.nodeId} />
          </div>
        </Card>
        <Card className="space-y-6 p-5">
          <TopList title="Principales sources" items={topSources} />
          <TopList title="Serveurs les plus visés" items={topTargets} />
        </Card>
      </div>

      {isLoading && !events ? (
        <Card className="space-y-3 p-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full" />
          ))}
        </Card>
      ) : shown.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 py-16 text-center">
          <motion.span
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, ease: EASE }}
            className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[hsl(var(--ok))]/10"
          >
            <ShieldCheck className="h-6 w-6 text-[hsl(var(--ok))]" />
          </motion.span>
          <p className="text-sm font-medium text-foreground">
            {filtered ? 'Rien ne correspond à ces filtres' : seenCount > 0 ? 'Tout a été examiné' : 'Calme plat sur cette période'}
          </p>
          <p className="max-w-md text-xs text-muted-foreground">
            Les tentatives refusées par vos règles, et en mode observation celles qui le seraient, s’affichent ici en direct.
          </p>
          {filtered && (
            <Button variant="secondary" size="sm" onClick={reset}>
              Effacer les filtres
            </Button>
          )}
        </Card>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group.day} className="space-y-2">
              <h3 className="px-1 text-xs font-medium capitalize text-muted-foreground">{group.day}</h3>
              <Card className="overflow-hidden">
                <ul className="divide-y divide-border">
                  <AnimatePresence initial={false}>
                    {group.events.map((event) => (
                      <EventRow
                        key={event.id}
                        event={event}
                        nodes={nodeById}
                        rules={ruleById}
                        onCreateRule={onCreateRule}
                        onTest={onTest}
                        onDismiss={onDismiss}
                        index={rowIndex++}
                        fresh={fresh.has(event.id)}
                      />
                    ))}
                  </AnimatePresence>
                </ul>
              </Card>
            </section>
          ))}
          {shown.length > limit && (
            <div className="flex justify-center">
              <Button variant="secondary" onClick={() => setLimit(limit + PAGE)}>
                Afficher plus ({shown.length - limit} restantes)
              </Button>
            </div>
          )}
        </div>
      )}

      {withoutLogging.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Journal indisponible sur {withoutLogging.map((node) => node.name).join(', ')} : le pare-feu y fonctionne, mais l’agent ne peut pas lire le journal du
          noyau.
        </p>
      )}
    </div>
  );
}
