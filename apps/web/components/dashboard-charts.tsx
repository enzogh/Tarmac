'use client';

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, Pie, PieChart, XAxis, YAxis } from 'recharts';
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from './ui/chart';
import { seriesColor } from '../lib/chart-colors';
import { formatCapacity, shortHostname } from '../lib/format';

// Shared axis setup. The previous charts each passed `margin={{ left: -16 }}`
// to claw back the gutter Recharts reserves for the Y axis, which pulled the
// axis itself partly off-canvas: "100" rendered as "0" and "75" as "5", so
// every chart in the app was labelled with a meaningless 0/5/0/5 ladder.
// The gutter is now paid for honestly and the labels fit.
const AXIS = {
  tickLine: false as const,
  axisLine: false as const,
  tickMargin: 8,
  stroke: 'hsl(var(--muted-foreground))',
  fontSize: 11,
};

const CHART_MARGIN = { left: 4, right: 8, top: 8, bottom: 0 };

const GRID = (
  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 6" />
);

/**
 * A chart with two or more series needs its key on screen, not only in a
 * hover tooltip - none of these had one, so "CPU & RAM de la flotte" showed
 * two unlabelled lines.
 */
function Legend({ config, keys }: { config: ChartConfig; keys: string[] }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {keys.map((key) => (
        <span key={key} className="flex items-center gap-1.5 text-2xs text-muted-foreground">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: config[key]?.color }} />
          {config[key]?.label ?? key}
        </span>
      ))}
    </div>
  );
}

export type FleetPerformancePoint = { label: string; cpu: number; ram: number };

const PERFORMANCE_CONFIG: ChartConfig = {
  cpu: { label: 'CPU moyen', color: seriesColor(0) },
  ram: { label: 'RAM moyenne', color: seriesColor(1) },
};

export function FleetPerformanceChart({ data }: { data: FleetPerformancePoint[] }) {
  if (data.length === 0) {
    return <ChartEmptyState label="Pas encore de mesures disponibles." />;
  }

  return (
    <div>
      <Legend config={PERFORMANCE_CONFIG} keys={['cpu', 'ram']} />
      <ChartContainer config={PERFORMANCE_CONFIG} className="h-56">
        <AreaChart data={data} margin={CHART_MARGIN}>
          <defs>
            <linearGradient id="fill-cpu" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-cpu)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--color-cpu)" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="fill-ram" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-ram)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--color-ram)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          {GRID}
          {/* minTickGap replaces a label every ~25px with one every ~70px:
              the 6h window produced some twenty overlapping timestamps. */}
          <XAxis dataKey="label" minTickGap={56} {...AXIS} />
          <YAxis domain={[0, 100]} width={44} unit=" %" {...AXIS} />
          <ChartTooltip content={<ChartTooltipContent valueFormatter={(v) => `${Math.round(v)} %`} />} />
          <Area dataKey="cpu" type="monotone" stroke="var(--color-cpu)" fill="url(#fill-cpu)" strokeWidth={1.75} isAnimationActive={false} />
          <Area dataKey="ram" type="monotone" stroke="var(--color-ram)" fill="url(#fill-ram)" strokeWidth={1.75} isAnimationActive={false} />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}

export type NetworkPoint = { label: string; rx: number; tx: number };

const NETWORK_CONFIG: ChartConfig = {
  rx: { label: 'Entrant', color: seriesColor(1) },
  tx: { label: 'Sortant', color: seriesColor(3) },
};

export function NetworkThroughputChart({ data }: { data: NetworkPoint[] }) {
  if (data.length === 0) {
    return <ChartEmptyState label="Pas encore de mesures réseau disponibles." />;
  }

  return (
    <div>
      <Legend config={NETWORK_CONFIG} keys={['rx', 'tx']} />
      <ChartContainer config={NETWORK_CONFIG} className="h-56">
        <AreaChart data={data} margin={CHART_MARGIN}>
          <defs>
            <linearGradient id="fill-rx" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-rx)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--color-rx)" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="fill-tx" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-tx)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--color-tx)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          {GRID}
          <XAxis dataKey="label" minTickGap={56} {...AXIS} />
          <YAxis width={46} tickFormatter={(value: number) => `${Math.round(value)}`} {...AXIS} />
          <ChartTooltip content={<ChartTooltipContent valueFormatter={(v) => `${v.toFixed(1)} Mb/s`} />} />
          <Area dataKey="rx" type="monotone" stroke="var(--color-rx)" fill="url(#fill-rx)" strokeWidth={1.75} isAnimationActive={false} />
          <Area dataKey="tx" type="monotone" stroke="var(--color-tx)" fill="url(#fill-tx)" strokeWidth={1.75} isAnimationActive={false} />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}

export type StorageSlice = { name: string; value: number };

/**
 * A donut plus a read-off list. The list carries the real information (each
 * node's capacity, in order), so it is right-aligned with tabular figures
 * and shares the slice's colour; the donut only conveys proportion.
 */
export function StorageBreakdownChart({ data }: { data: StorageSlice[] }) {
  if (data.length === 0 || data.every((slice) => slice.value === 0)) {
    return <ChartEmptyState label="Aucune donnée de stockage pour le moment." className="h-48" />;
  }

  const ordered = [...data].sort((left, right) => right.value - left.value);
  const total = ordered.reduce((sum, slice) => sum + slice.value, 0);
  const config: ChartConfig = Object.fromEntries(
    ordered.map((slice, index) => [slice.name, { label: slice.name, color: seriesColor(index) }]),
  );

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <ChartContainer config={config} className="h-44 w-44 shrink-0">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent valueFormatter={(v) => formatCapacity(v)} />} />
          <Pie data={ordered} dataKey="value" nameKey="name" innerRadius={48} outerRadius={70} paddingAngle={1.5}>
            {ordered.map((slice, index) => (
              <Cell key={slice.name} fill={seriesColor(index)} stroke="none" />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <ul className="min-w-0 flex-1 space-y-1">
        {ordered.map((slice, index) => (
          <li key={slice.name} className="flex items-center gap-3 text-xs">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: seriesColor(index) }} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground" title={slice.name}>
              {shortHostname(slice.name)}
            </span>
            <span className="tabular shrink-0 text-foreground/90">{formatCapacity(slice.value)}</span>
            <span className="tabular w-10 shrink-0 text-right text-muted-foreground">
              {total > 0 ? `${Math.round((slice.value / total) * 100)} %` : '—'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type NodeComparisonPoint = { name: string; cpu: number; ram: number };

const NODE_COMPARISON_CONFIG: ChartConfig = {
  cpu: { label: 'CPU', color: seriesColor(0) },
  ram: { label: 'RAM', color: seriesColor(1) },
};

export function NodeComparisonChart({ data }: { data: NodeComparisonPoint[] }) {
  if (data.length === 0) {
    return <ChartEmptyState label="Aucun nœud à comparer pour le moment." />;
  }

  return (
    <div>
      <Legend config={NODE_COMPARISON_CONFIG} keys={['cpu', 'ram']} />
      <ChartContainer config={NODE_COMPARISON_CONFIG} className="h-64">
        <BarChart data={data} margin={{ ...CHART_MARGIN, bottom: 8 }} barGap={2}>
          {GRID}
          {/* Node names are long FQDNs; showing the first label segment keeps
              the axis readable and the tooltip still carries the full name. */}
          <XAxis dataKey="name" tickFormatter={shortHostname} interval={0} {...AXIS} />
          <YAxis domain={[0, 100]} width={44} unit=" %" {...AXIS} />
          <ChartTooltip content={<ChartTooltipContent valueFormatter={(v) => `${Math.round(v)} %`} />} />
          <Bar dataKey="cpu" fill="var(--color-cpu)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="ram" fill="var(--color-ram)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ChartContainer>
    </div>
  );
}

export type SmartTrendPoint = { label: string; temperatureC: number; reallocatedSectors: number; pendingSectors: number };

const SMART_TREND_CONFIG: ChartConfig = {
  temperatureC: { label: 'Température', color: seriesColor(3) },
  reallocatedSectors: { label: 'Secteurs réalloués', color: seriesColor(4) },
  pendingSectors: { label: 'Secteurs en attente', color: seriesColor(6) },
};

export function SmartTrendChart({ data }: { data: SmartTrendPoint[] }) {
  if (data.length === 0) {
    return <ChartEmptyState label="Pas encore d’historique SMART pour ce disque." className="h-56" />;
  }

  return (
    <div>
      <Legend config={SMART_TREND_CONFIG} keys={['temperatureC', 'reallocatedSectors', 'pendingSectors']} />
      <ChartContainer config={SMART_TREND_CONFIG} className="h-48">
        <AreaChart data={data} margin={CHART_MARGIN}>
          {GRID}
          <XAxis dataKey="label" minTickGap={48} {...AXIS} />
          <YAxis yAxisId="temp" width={40} unit="°" {...AXIS} />
          <YAxis yAxisId="sectors" orientation="right" width={40} {...AXIS} />
          <ChartTooltip
            content={
              <ChartTooltipContent valueFormatter={(v, key) => (key === 'temperatureC' ? `${v} °C` : `${v} secteurs`)} />
            }
          />
          <Area
            yAxisId="temp"
            dataKey="temperatureC"
            type="monotone"
            stroke="var(--color-temperatureC)"
            fill="var(--color-temperatureC)"
            fillOpacity={0.1}
            strokeWidth={1.75}
            isAnimationActive={false}
          />
          <Line yAxisId="sectors" dataKey="reallocatedSectors" type="monotone" stroke="var(--color-reallocatedSectors)" strokeWidth={1.75} dot={false} isAnimationActive={false} />
          <Line yAxisId="sectors" dataKey="pendingSectors" type="monotone" stroke="var(--color-pendingSectors)" strokeWidth={1.75} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}

export type ConnectionHistoryPoint = { label: string; latencyMs: number | null; packetLoss: number | null };

const CONNECTION_HISTORY_CONFIG: ChartConfig = {
  latencyMs: { label: 'Latence', color: seriesColor(1) },
  packetLoss: { label: 'Perte de paquets', color: seriesColor(4) },
};

export function ConnectionHistoryChart({ data }: { data: ConnectionHistoryPoint[] }) {
  if (data.length === 0) {
    return <ChartEmptyState label="Pas encore d’historique pour ce lien." className="h-48" />;
  }

  return (
    <div>
      <Legend config={CONNECTION_HISTORY_CONFIG} keys={['latencyMs', 'packetLoss']} />
      <ChartContainer config={CONNECTION_HISTORY_CONFIG} className="h-44">
        <AreaChart data={data} margin={CHART_MARGIN}>
          {GRID}
          <XAxis dataKey="label" minTickGap={48} {...AXIS} />
          <YAxis yAxisId="latency" width={42} unit=" ms" {...AXIS} />
          <YAxis yAxisId="loss" orientation="right" domain={[0, 100]} width={38} unit="%" {...AXIS} />
          <ChartTooltip
            content={<ChartTooltipContent valueFormatter={(v, key) => (key === 'packetLoss' ? `${v} %` : `${v} ms`)} />}
          />
          <Area
            yAxisId="latency"
            dataKey="latencyMs"
            type="monotone"
            stroke="var(--color-latencyMs)"
            fill="var(--color-latencyMs)"
            fillOpacity={0.1}
            strokeWidth={1.75}
            connectNulls
            isAnimationActive={false}
          />
          <Line yAxisId="loss" dataKey="packetLoss" type="monotone" stroke="var(--color-packetLoss)" strokeWidth={1.75} dot={false} connectNulls isAnimationActive={false} />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}

export function ChartEmptyState({ label, className = 'h-56' }: { label: string; className?: string }) {
  return (
    <div className={`flex items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground ${className}`}>
      {label}
    </div>
  );
}
