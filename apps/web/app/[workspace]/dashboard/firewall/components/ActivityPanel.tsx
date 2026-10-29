'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, Ban, Container, Eye, Globe2, MoreHorizontal, Network, Radio, Search, ShieldCheck, Target, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ListSkeleton } from '@/components/ui/skeleton';
import { Stat, StatRow } from '@/components/ui/stat';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, FirewallEvent, FirewallNode, FirewallRule, FirewallScope } from '@/lib/api';
import { formatRelative, shortHostname } from '@/lib/format';
import { usePolling } from '@/lib/hooks/usePolling';
import { useLiveSocket } from '@/lib/hooks/useLiveSocket';
import { cn } from '@/lib/utils';
import type { RuleDraft } from './RuleDialog';

const ANY = '__any__';

export function useFirewallEvents(params: { hours: number; scope?: FirewallScope; verdict?: 'blocked' | 'observed'; nodeId?: string }) {
  const key = `firewall-events:${params.hours}:${params.scope ?? ''}:${params.verdict ?? ''}:${params.nodeId ?? ''}`;
  const result = usePolling(key, () => api.firewall.events(params), { intervalMs: 15000 });
  useLiveSocket((message) => {
    if (message.type === 'firewall.events') void result.mutate();
  });
  return result;
}

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

/** One blocked (or would-be blocked) flow, readable as a sentence. */
export function EventRow({
  event,
  nodes,
  rules,
  onCreateRule,
  compact,
}: {
  event: FirewallEvent;
  nodes: Map<string, FirewallNode>;
  rules: Map<string, FirewallRule>;
  onCreateRule: (draft: RuleDraft) => void;
  compact?: boolean;
}) {
  const target = nodes.get(event.nodeId);
  const sourceNode = event.sourceNodeId ? nodes.get(event.sourceNodeId) : null;
  const rule = event.ruleId ? rules.get(event.ruleId) : null;
  const blocked = event.verdict === 'blocked';
  const others = event.scope === 'public' ? event.sources.filter((ip) => ip !== event.sourceIp).length : 0;
  const drafts = draftsFor(event);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors hover:bg-surface-2/40 sm:flex-nowrap">
      <span
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
          blocked ? 'bg-[hsl(var(--danger))]/10 text-[hsl(var(--danger))]' : 'bg-[hsl(var(--info))]/10 text-[hsl(var(--info))]',
        )}
        title={blocked ? 'Bloquée' : 'Serait bloquée en mode appliqué'}
      >
        {blocked ? <Ban className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 text-sm">
          <span className={cn('truncate font-medium text-foreground', !sourceNode && 'font-mono text-[13px]')}>{sourceNode?.name ?? event.sourceIp}</span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium text-foreground">{target?.name ?? 'serveur supprimé'}</span>
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span className="text-foreground/80">{serviceText(event)}</span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1">
            {event.scope === 'mesh' ? <Network className="h-3 w-3" /> : <Globe2 className="h-3 w-3" />}
            {event.scope === 'mesh' ? 'Entre serveurs' : others > 0 ? `Internet, ${others + 1} adresses` : 'Internet'}
          </span>
          {event.docker && (
            <span className="inline-flex items-center gap-1">
              <Container className="h-3 w-3" />
              conteneur
            </span>
          )}
          {!compact && (
            <>
              <span aria-hidden>·</span>
              <span>{rule ? `règle « ${rule.name} »` : blocked ? 'aucune règle ne l’autorise' : 'mode observation'}</span>
            </>
          )}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <div className="text-right">
          <p className="tabular text-sm font-semibold text-foreground">{event.count.toLocaleString('fr-FR')}</p>
          <p className="text-2xs text-muted-foreground">{event.count > 1 ? 'tentatives' : 'tentative'}</p>
        </div>
        <p className="w-24 text-right text-xs text-muted-foreground" title={new Date(event.lastSeenAt).toLocaleString('fr-FR')}>
          {formatRelative(event.lastSeenAt)}
        </p>
        {!compact && (
          <div className="flex items-center gap-1">
            {!rule && (
              <Button write size="sm" variant="secondary" className="gap-1.5" onClick={() => onCreateRule(drafts.allow)}>
                <ShieldCheck className="h-3.5 w-3.5" />
                Autoriser
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Plus d’actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {rule && (
                  <DropdownMenuItem write onSelect={() => onCreateRule(drafts.allow)}>
                    <ShieldCheck />
                    Autoriser malgré tout
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem write onSelect={() => onCreateRule(drafts.block)} className="text-[hsl(var(--danger))]">
                  <Ban />
                  Bloquer cette source partout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </li>
  );
}

export function ActivityView({
  nodes,
  rules,
  onCreateRule,
}: {
  nodes: FirewallNode[];
  rules: FirewallRule[];
  onCreateRule: (draft: RuleDraft) => void;
}) {
  const [scope, setScope] = useState<'all' | FirewallScope>('all');
  const [verdict, setVerdict] = useState<'all' | 'blocked' | 'observed'>('all');
  const [hours, setHours] = useState('24');
  const [nodeId, setNodeId] = useState(ANY);
  const [query, setQuery] = useState('');
  const { data: events, isLoading } = useFirewallEvents({
    hours: Number(hours),
    scope: scope === 'all' ? undefined : scope,
    verdict: verdict === 'all' ? undefined : verdict,
    nodeId: nodeId === ANY ? undefined : nodeId,
  });

  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const ruleById = useMemo(() => new Map(rules.map((rule) => [rule.id, rule])), [rules]);
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return events ?? [];
    return (events ?? []).filter((event) =>
      [event.sourceIp, ...event.sources, nodeById.get(event.nodeId)?.name, event.sourceNodeId ? nodeById.get(event.sourceNodeId)?.name : '', event.service, String(event.port ?? '')]
        .filter(Boolean)
        .some((value) => (value as string).toLowerCase().includes(needle)),
    );
  }, [events, query, nodeById]);

  const total = (list: FirewallEvent[], kind: 'blocked' | 'observed') => list.filter((e) => e.verdict === kind).reduce((sum, e) => sum + e.count, 0);
  const sources = new Set(shown.flatMap((event) => (event.scope === 'public' ? event.sources : [event.sourceIp]))).size;
  const perTarget = new Map<string, number>();
  for (const event of shown) perTarget.set(event.nodeId, (perTarget.get(event.nodeId) ?? 0) + event.count);
  const top = [...perTarget.entries()].sort((a, b) => b[1] - a[1])[0];
  const filtered = scope !== 'all' || verdict !== 'all' || nodeId !== ANY || query.trim() !== '';
  const withoutLogging = nodes.filter((node) => node.report && !node.report.logging && node.apply.status === 'active');
  const periodLabel = { '1': 'sur 1 h', '24': 'sur 24 h', '168': 'sur 7 jours', '336': 'sur 14 jours' }[hours];

  return (
    <div className="space-y-6">
      <StatRow>
        <Stat label="Bloquées" value={total(shown, 'blocked').toLocaleString('fr-FR')} icon={Ban} tone={total(shown, 'blocked') > 0 ? 'danger' : 'neutral'} hint={periodLabel} />
        <Stat label="Seraient bloquées" value={total(shown, 'observed').toLocaleString('fr-FR')} icon={Eye} tone={total(shown, 'observed') > 0 ? 'info' : 'neutral'} hint="Mode observation" />
        <Stat label="Sources distinctes" value={sources} icon={Users} hint="Serveurs ou adresses IP" />
        <Stat label="Serveur le plus visé" value={top ? shortHostname(nodeById.get(top[0])?.name ?? '—') : '—'} icon={Target} hint={top ? `${top[1].toLocaleString('fr-FR')} tentative(s)` : 'Aucune tentative'} />
      </StatRow>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <Tabs value={scope} onValueChange={(value) => setScope(value as typeof scope)}>
            <TabsList variant="segmented">
              <TabsTrigger value="all">Tout</TabsTrigger>
              <TabsTrigger value="mesh">Entre serveurs</TabsTrigger>
              <TabsTrigger value="public">Internet</TabsTrigger>
            </TabsList>
          </Tabs>
          <Tabs value={verdict} onValueChange={(value) => setVerdict(value as typeof verdict)}>
            <TabsList variant="segmented">
              <TabsTrigger value="all">Tous</TabsTrigger>
              <TabsTrigger value="blocked">Bloquées</TabsTrigger>
              <TabsTrigger value="observed">Observées</TabsTrigger>
            </TabsList>
          </Tabs>
          <Select value={hours} onValueChange={setHours}>
            <SelectTrigger className="h-8 w-auto min-w-[8.5rem] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Dernière heure</SelectItem>
              <SelectItem value="24">24 dernières heures</SelectItem>
              <SelectItem value="168">7 derniers jours</SelectItem>
              <SelectItem value="336">14 derniers jours</SelectItem>
            </SelectContent>
          </Select>
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
          <div className="relative min-w-[11rem] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Serveur, IP ou port…" className="h-8 pl-8" />
          </div>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1"
              onClick={() => {
                setScope('all');
                setVerdict('all');
                setNodeId(ANY);
                setQuery('');
              }}
            >
              <X className="h-3.5 w-3.5" />
              Réinitialiser
            </Button>
          )}
          <span className="ml-auto inline-flex items-center gap-1.5 text-2xs text-muted-foreground">
            <Radio className="h-3 w-3 text-[hsl(var(--ok))]" />
            En direct
          </span>
        </div>

        {isLoading && !events ? (
          <div className="p-4">
            <ListSkeleton rows={5} />
          </div>
        ) : shown.length === 0 ? (
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[hsl(var(--ok))]/10">
              <ShieldCheck className="h-5 w-5 text-[hsl(var(--ok))]" />
            </span>
            <p className="text-sm font-medium text-foreground">{filtered ? 'Rien ne correspond à ces filtres' : 'Aucune connexion bloquée sur cette période'}</p>
            <p className="max-w-md text-xs text-muted-foreground">
              Les tentatives refusées par vos règles, et en mode observation celles qui le seraient, s’affichent ici en direct.
            </p>
          </CardContent>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((event) => (
              <EventRow key={event.id} event={event} nodes={nodeById} rules={ruleById} onCreateRule={onCreateRule} />
            ))}
          </ul>
        )}
      </Card>

      {withoutLogging.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Journal indisponible sur {withoutLogging.map((node) => node.name).join(', ')} : le pare-feu y fonctionne, mais l’agent ne peut pas lire le journal du
          noyau (conteneur ou noyau restreint).
        </p>
      )}
    </div>
  );
}
