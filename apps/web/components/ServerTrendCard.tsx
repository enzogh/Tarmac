'use client';

import { useId, useMemo } from 'react';
import { Cpu, Network, HardDrive } from 'lucide-react';
import { NodeActivityItem, NodeMetricSample } from '../lib/api';
import { cn } from '../lib/utils';
import { Badge, NodeLabelBadges } from './ui';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Progress } from './ui/progress';

type SparklineProps = {
  values: number[];
  strokeClassName?: string;
  fillClassName?: string;
  className?: string;
  height?: number;
  minValue?: number;
  maxValue?: number;
};

export function Sparkline({
  values,
  strokeClassName = 'stroke-violet-300',
  fillClassName = 'fill-violet-500/10',
  className,
  height = 56,
  minValue = 0,
  maxValue = 100,
}: SparklineProps) {
  const gradientId = useId();

  const { linePath, areaPath } = useMemo(() => {
    if (values.length === 0) {
      return { linePath: '', areaPath: '' };
    }

    const width = 100;
    const chartHeight = 40;
    const padding = 4;
    const min = Math.min(minValue, ...values);
    const max = Math.max(maxValue, ...values);
    const range = max - min || 1;
    const points = values.map((value, index) => {
      const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
      const normalized = (value - min) / range;
      const y = chartHeight - padding - normalized * (chartHeight - padding * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });

    const line = `M ${points.join(' L ')}`;
    const area = `M 0 ${chartHeight - padding} L ${points.join(' L ')} L ${width} ${chartHeight - padding} Z`;

    return {
      linePath: line,
      areaPath: area,
    };
  }, [maxValue, minValue, values]);

  return (
    <svg
      viewBox="0 0 100 40"
      className={cn('w-full overflow-visible', className)}
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-label="Graphique de tendance"
    >
      <defs>
        <linearGradient id={`${gradientId}-stroke`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.55" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="1" />
        </linearGradient>
        <linearGradient id={`${gradientId}-fill`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>

      <g className="opacity-40">
        <line x1="0" y1="4" x2="100" y2="4" stroke="currentColor" strokeOpacity="0.1" strokeWidth="0.5" />
        <line x1="0" y1="20" x2="100" y2="20" stroke="currentColor" strokeOpacity="0.1" strokeWidth="0.5" />
        <line x1="0" y1="36" x2="100" y2="36" stroke="currentColor" strokeOpacity="0.1" strokeWidth="0.5" />
      </g>

      {areaPath && <path d={areaPath} className={cn(fillClassName)} fill={`url(#${gradientId}-fill)`} />}
      {linePath && (
        <path
          d={linePath}
          className={cn(strokeClassName)}
          fill="none"
          stroke={`url(#${gradientId}-stroke)`}
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

type ServerTrendCardProps = {
  node: NodeActivityItem;
  samples: NodeMetricSample[];
  labels?: string[];
  className?: string;
};

const formatRate = (value: number) => `${((value * 8) / 1_000_000).toFixed(2)} MBPS`;

export function ServerTrendCard({ node, samples, labels = [], className }: ServerTrendCardProps) {
  const cpuSeries = samples.map((sample) => sample.cpu);
  const ramSeries = samples.map((sample) => sample.ram);
  const cpuDelta = cpuSeries.length > 1 ? cpuSeries[cpuSeries.length - 1] - cpuSeries[0] : 0;
  const latestSample = samples[samples.length - 1];
  const diskRatio = node.storage.usageRatio * 100;

  return (
    <Card className={cn('bg-panel-glow', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{node.name}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground capitalize">
              {node.role}
              {node.lastSeenAt ? ` · ${new Date(node.lastSeenAt).toLocaleString('fr-FR')}` : ''}
            </p>
            {labels.length > 0 && <NodeLabelBadges labels={labels} className="mt-2" />}
          </div>
          <Badge
            label={node.status}
            type={node.status === 'online' ? 'success' : node.status === 'degraded' ? 'warning' : 'error'}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Cpu className="h-3.5 w-3.5" />
              CPU
            </span>
            <span>{Math.round(node.metrics.cpu)}% · {cpuDelta >= 0 ? '+' : ''}{cpuDelta.toFixed(1)} pts</span>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.015] p-3">
              <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>CPU (%)</span>
                <span>{cpuSeries.length > 0 ? `${Math.round(cpuSeries[cpuSeries.length - 1])}%` : 'N/A'}</span>
              </div>
              <Sparkline values={cpuSeries} className="text-violet-300" height={44} minValue={0} maxValue={100} />
            </div>
            <div className="rounded-xl border border-white/[0.05] bg-white/[0.015] p-3">
              <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>RAM (%)</span>
                <span>{ramSeries.length > 0 ? `${Math.round(ramSeries[ramSeries.length - 1])}%` : 'N/A'}</span>
              </div>
              <Sparkline values={ramSeries} className="text-cyan-300" height={44} minValue={0} maxValue={100} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-muted-foreground">RAM actuelle</p>
              <p className="font-medium text-foreground">{Math.round(node.metrics.ram)}%</p>
            </div>
            <div>
              <p className="text-muted-foreground">Dernier point</p>
              <p className="font-medium text-foreground">
                {latestSample ? new Date(latestSample.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : 'N/A'}
              </p>
            </div>
          </div>
          <Progress value={node.metrics.cpu} className="mt-3 h-1.5" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Network className="h-3.5 w-3.5" />
              Réseau RX / TX
            </div>
            <p className="mt-2 font-medium text-foreground">{formatRate(node.metrics.networkRx)} · {formatRate(node.metrics.networkTx)}</p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs">
            <div className="flex items-center gap-2 text-muted-foreground">
              <HardDrive className="h-3.5 w-3.5" />
              Stockage
            </div>
            <p className="mt-2 font-medium text-foreground">
              {node.storage.totalUsedGb} / {node.storage.totalCapacityGb} GB
            </p>
            <p className="mt-1 text-muted-foreground">{Math.round(diskRatio)}% utilisé</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
