'use client';

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, Pie, PieChart, XAxis, YAxis } from 'recharts';
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from './ui/chart';

const PIE_COLORS = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'] as const;

export type FleetPerformancePoint = { label: string; cpu: number; ram: number };

const PERFORMANCE_CONFIG: ChartConfig = {
  cpu: { label: 'CPU moyen', color: 'hsl(var(--chart-1))' },
  ram: { label: 'RAM moyenne', color: 'hsl(var(--chart-2))' },
};

export function FleetPerformanceChart({ data }: { data: FleetPerformancePoint[] }) {
  if (data.length === 0) {
    return <ChartEmptyState label="Pas encore de mesures disponibles." />;
  }

  return (
    <ChartContainer config={PERFORMANCE_CONFIG} className="h-64">
      <AreaChart data={data} margin={{ left: -16, right: 8, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="fill-cpu" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-cpu)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-cpu)" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="fill-ram" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-ram)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-ram)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="4 8" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tickMargin={8} width={36} />
        <ChartTooltip content={<ChartTooltipContent valueFormatter={(v) => `${Math.round(v)}%`} />} />
        <Area dataKey="cpu" type="monotone" stroke="var(--color-cpu)" fill="url(#fill-cpu)" strokeWidth={2} />
        <Area dataKey="ram" type="monotone" stroke="var(--color-ram)" fill="url(#fill-ram)" strokeWidth={2} />
      </AreaChart>
    </ChartContainer>
  );
}

export type NetworkPoint = { label: string; rx: number; tx: number };

const NETWORK_CONFIG: ChartConfig = {
  rx: { label: 'Débit descendant', color: 'hsl(var(--chart-2))' },
  tx: { label: 'Débit montant', color: 'hsl(var(--chart-4))' },
};

export function NetworkThroughputChart({ data }: { data: NetworkPoint[] }) {
  if (data.length === 0) {
    return <ChartEmptyState label="Pas encore de mesures réseau disponibles." />;
  }

  return (
    <ChartContainer config={NETWORK_CONFIG} className="h-64">
      <AreaChart data={data} margin={{ left: -16, right: 8, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="fill-rx" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-rx)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-rx)" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="fill-tx" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-tx)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-tx)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="4 8" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={44} />
        <ChartTooltip content={<ChartTooltipContent valueFormatter={(v) => `${v.toFixed(2)} MB/s`} />} />
        <Area
          dataKey="rx"
          type="monotone"
          stroke="var(--color-rx)"
          fill="url(#fill-rx)"
          strokeWidth={2}
          isAnimationActive={false}
        />
        <Area
          dataKey="tx"
          type="monotone"
          stroke="var(--color-tx)"
          fill="url(#fill-tx)"
          strokeWidth={2}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}

export type StorageSlice = { name: string; value: number };

export function StorageBreakdownChart({ data }: { data: StorageSlice[] }) {
  if (data.length === 0 || data.every((slice) => slice.value === 0)) {
    return <ChartEmptyState label="Aucune donnée de stockage pour le moment." className="h-48" />;
  }

  const config: ChartConfig = Object.fromEntries(
    data.map((slice, index) => [
      slice.name,
      { label: slice.name, color: `hsl(var(--${PIE_COLORS[index % PIE_COLORS.length]}))` },
    ]),
  );

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <ChartContainer config={config} className="h-48 w-full sm:w-1/2">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent valueFormatter={(v) => `${v} GB`} />} />
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2}>
            {data.map((slice, index) => (
              <Cell key={slice.name} fill={`hsl(var(--${PIE_COLORS[index % PIE_COLORS.length]}))`} stroke="none" />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="flex-1 space-y-1.5">
        {data.map((slice, index) => (
          <div key={slice.name} className="flex items-center justify-between gap-3 text-xs">
            <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: `hsl(var(--${PIE_COLORS[index % PIE_COLORS.length]}))` }}
              />
              <span className="truncate" title={slice.name}>
                {slice.name}
              </span>
            </span>
            <span className="shrink-0 font-mono text-foreground/90">{slice.value} GB</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export type NodeComparisonPoint = { name: string; cpu: number; ram: number };

const NODE_COMPARISON_CONFIG: ChartConfig = {
  cpu: { label: 'CPU %', color: 'hsl(var(--chart-1))' },
  ram: { label: 'RAM %', color: 'hsl(var(--chart-2))' },
};

export function NodeComparisonChart({ data }: { data: NodeComparisonPoint[] }) {
  if (data.length === 0) {
    return <ChartEmptyState label="Aucun nœud à comparer pour le moment." />;
  }

  return (
    <ChartContainer config={NODE_COMPARISON_CONFIG} className="h-72">
      <BarChart data={data} margin={{ left: -16, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="4 8" />
        <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis domain={[0, 100]} tickLine={false} axisLine={false} tickMargin={8} width={36} />
        <ChartTooltip content={<ChartTooltipContent valueFormatter={(v) => `${Math.round(v)}%`} />} />
        <Bar dataKey="cpu" fill="var(--color-cpu)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="ram" fill="var(--color-ram)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

export type SmartTrendPoint = { label: string; temperatureC: number; reallocatedSectors: number; pendingSectors: number };

const SMART_TREND_CONFIG: ChartConfig = {
  temperatureC: { label: 'Température', color: 'hsl(var(--chart-1))' },
  reallocatedSectors: { label: 'Secteurs réalloués', color: 'hsl(var(--chart-4))' },
  pendingSectors: { label: 'Secteurs en attente', color: 'hsl(var(--chart-5))' },
};

export function SmartTrendChart({ data }: { data: SmartTrendPoint[] }) {
  if (data.length === 0) {
    return <ChartEmptyState label="Pas encore d’historique SMART pour ce disque." className="h-56" />;
  }

  return (
    <ChartContainer config={SMART_TREND_CONFIG} className="h-56">
      <AreaChart data={data} margin={{ left: -16, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="4 8" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis yAxisId="temp" tickLine={false} axisLine={false} tickMargin={8} width={36} />
        <YAxis yAxisId="sectors" orientation="right" tickLine={false} axisLine={false} tickMargin={8} width={36} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              valueFormatter={(v, key) => (key === 'temperatureC' ? `${v}°C` : `${v} secteurs`)}
            />
          }
        />
        <Area
          yAxisId="temp"
          dataKey="temperatureC"
          type="monotone"
          stroke="var(--color-temperatureC)"
          fill="var(--color-temperatureC)"
          fillOpacity={0.12}
          strokeWidth={2}
        />
        <Line
          yAxisId="sectors"
          dataKey="reallocatedSectors"
          type="monotone"
          stroke="var(--color-reallocatedSectors)"
          strokeWidth={2}
          dot={false}
        />
        <Line
          yAxisId="sectors"
          dataKey="pendingSectors"
          type="monotone"
          stroke="var(--color-pendingSectors)"
          strokeWidth={2}
          dot={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}

function ChartEmptyState({ label, className = 'h-64' }: { label: string; className?: string }) {
  return <div className={`flex items-center justify-center text-sm text-muted-foreground ${className}`}>{label}</div>;
}
