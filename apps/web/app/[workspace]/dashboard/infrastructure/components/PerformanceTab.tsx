'use client';

import { useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { ArrowDownToLine, ArrowUpToLine, ChevronRight, Cpu, Gauge, HardDrive, Network, Search, type LucideIcon } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { ChartEmptyState } from '@/components/dashboard-charts';
import { Input } from '@/components/ui/input';
import { ChartCardSkeleton, NodesTableSkeleton, StatCardSkeleton } from '@/components/ui/skeleton';
import { NODE_STATUS, StatusDot, describe } from '@/components/ui/status';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, NodeActivityItem, NodeSeriesPoint } from '@/lib/api';
import { seriesColor } from '@/lib/chart-colors';
import { formatRelative, formatThroughput, shortHostname } from '@/lib/format';
import { usePolling } from '@/lib/hooks/usePolling';
import { cn } from '@/lib/utils';
import { cpuShape, memoryUsage } from '@/lib/system-info';
import { MiniMeter, SwapLine } from './node-ui';

type MetricKey = 'cpu' | 'ram' | 'disk' | 'network';
type Range = '1h' | '6h' | '24h';

const TREND_LINES = 6;
const RANGE_LABEL: Record<Range, string> = { '1h': '1 h', '6h': '6 h', '24h': '24 h' };

// One description per metric: how to read it from a node's live snapshot
// and from a series point, its unit, and the wording around it.
const METRICS: Record<
  MetricKey,
  {
    label: string;
    sortLabel: string;
    hotspot: string;
    icon: LucideIcon;
    percent: boolean;
    now: (node: NodeActivityItem) => number;
    point: (point: NodeSeriesPoint) => number;
  }
> = {
  cpu: { label: 'CPU', sortLabel: 'CPU actuel', hotspot: 'CPU le plus sollicité', icon: Cpu, percent: true, now: (n) => n.metrics.cpu, point: (p) => p.cpu },
  ram: { label: 'RAM', sortLabel: 'RAM actuelle', hotspot: 'Mémoire la plus occupée', icon: Gauge, percent: true, now: (n) => n.metrics.ram, point: (p) => p.ram },
  disk: {
    label: 'Disque',
    sortLabel: 'taux de remplissage',
    hotspot: 'Stockage le plus rempli',
    icon: HardDrive,
    percent: true,
    // The live figure is the node's real volume inventory; the series only
    // carries the agent's root-filesystem percentage.
    now: (n) => n.storage.usageRatio * 100,
    point: (p) => p.disk,
  },
  network: {
    label: 'Réseau',
    sortLabel: 'trafic actuel (entrant + sortant)',
    hotspot: 'Trafic le plus élevé',
    icon: Network,
    percent: false,
    now: (n) => n.metrics.networkRx + n.metrics.networkTx,
    point: (p) => p.networkRx + p.networkTx,
  },
};

const formatValue = (metric: MetricKey, value: number) =>
  METRICS[metric].percent ? `${Math.round(value)} %` : formatThroughput(value);

const timeLabel = (iso: string, range: Range) =>
  new Date(iso).toLocaleTimeString('fr-FR', range === '24h' ? { hour: '2-digit' } : { hour: '2-digit', minute: '2-digit' });

function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return <span className="block h-6 w-24 text-center text-2xs leading-6 text-muted-foreground">—</span>;
  const max = Math.max(...values, 1e-9);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const points = values.map((value, index) => `${((index / (values.length - 1)) * 100).toFixed(1)},${(22 - ((value - min) / span) * 20).toFixed(1)}`);
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className={cn('h-6 w-24 overflow-visible', className)} aria-hidden>
      <polyline points={`0,24 ${points.join(' ')} 100,24`} className="fill-current opacity-10" stroke="none" />
      <polyline points={points.join(' ')} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function HotspotCard({
  metric,
  active,
  node,
  average,
  onSelect,
  onOpenNode,
}: {
  metric: MetricKey;
  active: boolean;
  node: NodeActivityItem | null;
  average: number;
  onSelect: () => void;
  onOpenNode: (node: NodeActivityItem) => void;
}) {
  const spec = METRICS[metric];
  const value = node ? spec.now(node) : 0;
  const tone = spec.percent ? (value >= 85 ? 'danger' : value >= 65 ? 'warn' : 'ok') : 'neutral';
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && onSelect()}
      aria-pressed={active}
      className={cn(
        'group relative flex cursor-pointer flex-col gap-3 rounded-xl border bg-surface-1 p-4 text-left transition-colors',
        active ? 'border-primary/50 ring-1 ring-primary/30' : 'border-border hover:border-foreground/20',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', active ? 'bg-primary/15 text-primary' : 'bg-surface-2')}>
            <spec.icon className="h-3.5 w-3.5" />
          </span>
          {spec.hotspot}
        </span>
      </div>
      {node ? (
        <>
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                'text-2xl font-semibold tabular-nums tracking-tight',
                tone === 'danger' && 'text-[hsl(var(--danger))]',
                tone === 'warn' && 'text-[hsl(var(--warn))]',
                (tone === 'ok' || tone === 'neutral') && 'text-foreground',
              )}
            >
              {formatValue(metric, value)}
            </span>
            <span className="text-2xs text-muted-foreground">moyenne {formatValue(metric, average)}</span>
          </div>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenNode(node);
            }}
            className="-mx-1 flex min-w-0 items-center gap-1 rounded px-1 text-xs text-foreground/90 hover:bg-surface-2 hover:text-foreground"
            title={`Ouvrir ${node.name}`}
          >
            <span className="truncate font-medium">{shortHostname(node.name)}</span>
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Aucun nœud joignable.</p>
      )}
    </div>
  );
}

export function PerformanceTab({
  nodes,
  loading,
  labels,
  onOpenNode,
}: {
  nodes: NodeActivityItem[];
  loading: boolean;
  labels: Record<string, string[]>;
  onOpenNode: (node: NodeActivityItem) => void;
}) {
  const [metric, setMetric] = useState<MetricKey>('cpu');
  const [range, setRange] = useState<Range>('6h');
  const [query, setQuery] = useState('');
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  // One aggregated request for the whole fleet (see /nodes/activity/series),
  // mounted only while this tab is shown.
  const { data: seriesData, isLoading: seriesLoading } = usePolling(`activity-series:${range}`, () => api.nodes.activitySeries(range), {
    intervalMs: 60000,
  });
  const series = useMemo(() => seriesData?.series ?? {}, [seriesData]);
  const spec = METRICS[metric];

  const reachable = useMemo(() => nodes.filter((node) => node.status !== 'offline'), [nodes]);
  const hotspots = useMemo(
    () =>
      (Object.keys(METRICS) as MetricKey[]).map((key) => {
        const pick = METRICS[key].now;
        const top = reachable.reduce<NodeActivityItem | null>((best, node) => (!best || pick(node) > pick(best) ? node : best), null);
        const average = reachable.length ? reachable.reduce((acc, node) => acc + pick(node), 0) / reachable.length : 0;
        return { key, top, average };
      }),
    [reachable],
  );

  const ranked = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return nodes
      .filter((node) => !needle || [node.name, node.role, ...(labels[node.id] ?? [])].some((value) => value.toLowerCase().includes(needle)))
      .sort((left, right) => {
        // Offline nodes report stale figures: they go last, not first.
        const offline = Number(left.status === 'offline') - Number(right.status === 'offline');
        return offline || spec.now(right) - spec.now(left) || left.name.localeCompare(right.name);
      });
  }, [nodes, query, labels, spec]);

  const trendNodes = useMemo(() => ranked.filter((node) => node.status !== 'offline' && series[node.id]?.length).slice(0, TREND_LINES), [ranked, series]);

  const { chartData, chartConfig } = useMemo(() => {
    const scale = (value: number) => (spec.percent ? value : (value * 8) / 1_000_000);
    const byTime = new Map<string, Record<string, number | string>>();
    for (const node of trendNodes) {
      for (const point of series[node.id] ?? []) {
        const row = byTime.get(point.t) ?? { t: point.t };
        row[node.id] = Math.round(scale(spec.point(point)) * 10) / 10;
        byTime.set(point.t, row);
      }
    }
    // Fleet average over every reachable node, not only the lines drawn.
    for (const node of reachable) {
      for (const point of series[node.id] ?? []) {
        const row = byTime.get(point.t) ?? { t: point.t };
        row.__sum = ((row.__sum as number) ?? 0) + scale(spec.point(point));
        row.__count = ((row.__count as number) ?? 0) + 1;
        byTime.set(point.t, row);
      }
    }
    const data = [...byTime.values()]
      .sort((a, b) => String(a.t).localeCompare(String(b.t)))
      .map(({ __sum, __count, ...row }) => ({
        ...row,
        label: timeLabel(String(row.t), range),
        fleet: __count ? Math.round(((__sum as number) / (__count as number)) * 10) / 10 : undefined,
      }));
    const config: ChartConfig = { fleet: { label: 'Moyenne flotte', color: 'hsl(var(--muted-foreground))' } };
    trendNodes.forEach((node, index) => {
      config[node.id] = { label: shortHostname(node.name), color: seriesColor(index) };
    });
    return { chartData: data, chartConfig: config };
  }, [trendNodes, reachable, series, spec, range]);

  const toggleLine = (key: string) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <StatCardSkeleton key={index} />
          ))}
        </div>
        <ChartCardSkeleton />
        <Card className="overflow-hidden">
          <NodesTableSkeleton rows={4} />
        </Card>
      </div>
    );
  }

  if (nodes.length === 0) {
    return <Card className="py-12 text-center text-sm text-muted-foreground">Aucun nœud enregistré pour le moment.</Card>;
  }

  return (
    <div className="animate-fade-in space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={metric} onValueChange={(value) => setMetric(value as MetricKey)}>
          <TabsList variant="segmented" aria-label="Métrique">
            {(Object.keys(METRICS) as MetricKey[]).map((key) => {
              const Icon = METRICS[key].icon;
              return (
                <TabsTrigger key={key} value={key} className="gap-1.5">
                  <Icon className="h-3.5 w-3.5" />
                  {METRICS[key].label}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
        <Tabs value={range} onValueChange={(value) => setRange(value as Range)}>
          <TabsList variant="segmented" aria-label="Période">
            {(Object.keys(RANGE_LABEL) as Range[]).map((key) => (
              <TabsTrigger key={key} value={key}>
                {RANGE_LABEL[key]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {hotspots.map((hotspot) => (
          <HotspotCard
            key={hotspot.key}
            metric={hotspot.key}
            active={metric === hotspot.key}
            node={hotspot.top}
            average={hotspot.average}
            onSelect={() => setMetric(hotspot.key)}
            onOpenNode={onOpenNode}
          />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <spec.icon className="h-4 w-4 text-primary" />
            Évolution {metric === 'network' ? 'du trafic' : `de l’usage ${spec.label}`} · {RANGE_LABEL[range]}
          </CardTitle>
          <CardDescription>
            {trendNodes.length > 0
              ? `Les ${trendNodes.length} nœuds les plus chargés, et la moyenne de la flotte en pointillés. Cliquez une légende pour masquer sa courbe.`
              : 'Pas encore de mesures sur cette période.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {seriesLoading && !seriesData ? (
            <ChartEmptyState label="Chargement des mesures…" className="h-64" />
          ) : chartData.length === 0 ? (
            <ChartEmptyState label="Pas encore de mesures sur cette période." className="h-64" />
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                {['fleet', ...trendNodes.map((node) => node.id)].map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleLine(key)}
                    aria-pressed={!hidden.has(key)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-2xs transition-colors hover:bg-surface-2',
                      hidden.has(key) ? 'text-muted-foreground/50 line-through' : 'text-foreground/90',
                    )}
                  >
                    <span
                      className={cn('h-2 w-2 rounded-full', key === 'fleet' && 'rounded-none border-t-2 border-dashed bg-transparent')}
                      style={key === 'fleet' ? { borderColor: chartConfig.fleet.color, width: 10, height: 0 } : { backgroundColor: chartConfig[key]?.color }}
                    />
                    {chartConfig[key]?.label}
                  </button>
                ))}
              </div>
              <ChartContainer config={chartConfig} className="h-64">
                <LineChart data={chartData} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 6" />
                  <XAxis dataKey="label" minTickGap={48} tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
                  <YAxis
                    width={52}
                    // Usage often sits at a few percent: a fixed 0-100 axis flattens it.
                    domain={spec.percent ? [0, (max: number) => Math.min(100, Math.max(10, Math.ceil(max / 10) * 10))] : [0, 'auto']}
                    tickFormatter={(value: number) => (spec.percent ? `${value} %` : `${value}`)}
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    label={spec.percent ? undefined : { value: 'Mb/s', angle: -90, position: 'insideLeft', fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  />
                  <ChartTooltip content={<ChartTooltipContent valueFormatter={(v) => (spec.percent ? `${Math.round(v)} %` : `${v.toFixed(1)} Mb/s`)} />} />
                  {!hidden.has('fleet') && (
                    <Line dataKey="fleet" type="monotone" stroke="var(--color-fleet)" strokeDasharray="4 4" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  )}
                  {trendNodes
                    .filter((node) => !hidden.has(node.id))
                    .map((node) => (
                      <Line
                        key={node.id}
                        dataKey={node.id}
                        type="monotone"
                        stroke={`var(--color-${node.id})`}
                        strokeWidth={1.75}
                        dot={false}
                        connectNulls
                        isAnimationActive={false}
                      />
                    ))}
                </LineChart>
              </ChartContainer>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Classement des nœuds</CardTitle>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filtrer par nom, rôle, libellé…" className="h-8 pl-8" />
          </div>
          <CardDescription>
            Triés par {spec.sortLabel}. La tendance couvre les dernières {RANGE_LABEL[range]}. Cliquez un nœud pour son détail.
          </CardDescription>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-2xs uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Nœud</th>
                {(['cpu', 'ram', 'disk'] as const).map((key) => (
                  <th key={key} className="px-3 py-2.5 font-medium">
                    <button type="button" onClick={() => setMetric(key)} className={cn('uppercase tracking-wider hover:text-foreground', metric === key && 'text-foreground')}>
                      {METRICS[key].label}
                      {metric === key && ' ↓'}
                    </button>
                  </th>
                ))}
                <th className="px-3 py-2.5 font-medium">
                  <button type="button" onClick={() => setMetric('network')} className={cn('uppercase tracking-wider hover:text-foreground', metric === 'network' && 'text-foreground')}>
                    Réseau{metric === 'network' && ' ↓'}
                  </button>
                </th>
                <th className="px-3 py-2.5 font-medium">Tendance {spec.label}</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {ranked.map((node) => {
                const status = describe(NODE_STATUS, node.status);
                const offline = node.status === 'offline';
                const points = series[node.id] ?? [];
                return (
                  <tr
                    key={node.id}
                    onClick={() => onOpenNode(node)}
                    className={cn('group cursor-pointer border-b border-border/70 transition-colors last:border-0 hover:bg-surface-2/60', offline && 'opacity-60')}
                  >
                    <td className="max-w-[18rem] px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <StatusDot tone={status.tone} />
                        <span className="truncate font-medium text-foreground" title={node.name}>
                          {shortHostname(node.name)}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate pl-4 text-2xs text-muted-foreground">
                        {offline ? `Hors ligne · vu ${formatRelative(node.lastSeenAt)}` : <span className="capitalize">{node.role}</span>}
                        {(labels[node.id] ?? []).length > 0 && ` · ${labels[node.id].join(', ')}`}
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      <MiniMeter value={node.metrics.cpu} className="w-28" />
                      {cpuShape(node.systemInfo) && <span className="mt-0.5 block text-2xs text-muted-foreground">{cpuShape(node.systemInfo)}</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <MiniMeter value={node.metrics.ram} className="w-28" />
                      {memoryUsage(node.systemInfo, node.metrics.ram) && (
                        <span className="mt-0.5 block whitespace-nowrap text-2xs tabular-nums text-muted-foreground">
                          {memoryUsage(node.systemInfo, node.metrics.ram)!.label}
                        </span>
                      )}
                      <SwapLine info={node.systemInfo} className="mt-0.5" />
                    </td>
                    <td className="px-3 py-2.5">
                      <MiniMeter value={node.storage.usageRatio * 100} className="w-28" />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-2xs tabular-nums text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <ArrowDownToLine className="h-3 w-3" />
                        {formatThroughput(node.metrics.networkRx)}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1">
                        <ArrowUpToLine className="h-3 w-3" />
                        {formatThroughput(node.metrics.networkTx)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-primary">
                      <Sparkline values={points.map(spec.point)} />
                    </td>
                    <td className="pr-3">
                      <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </td>
                  </tr>
                );
              })}
              {ranked.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    Aucun nœud ne correspond à « {query} ».
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
