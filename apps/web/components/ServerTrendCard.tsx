'use client';

import { useId, useMemo } from 'react';
import { ArrowDownToLine, ArrowUpToLine, Cpu, Gauge, HardDrive } from 'lucide-react';
import { NodeActivityItem, NodeMetricSample } from '../lib/api';
import { cn, meterTone } from '../lib/utils';
import { NodeLabelBadges } from './ui';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { NODE_STATUS, StatusPill, describe } from './ui/status';
import { formatCapacity, formatRelative, formatThroughput } from '../lib/format';

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

export function ServerTrendCard({ node, samples, labels = [], className }: ServerTrendCardProps) {
  const cpuSeries = samples.map((sample) => sample.cpu);
  const ramSeries = samples.map((sample) => sample.ram);
  const cpuNow = cpuSeries.length > 0 ? cpuSeries[cpuSeries.length - 1] : node.metrics.cpu;
  const ramNow = ramSeries.length > 0 ? ramSeries[ramSeries.length - 1] : node.metrics.ram;
  const cpuDelta = cpuSeries.length > 1 ? cpuSeries[cpuSeries.length - 1] - cpuSeries[0] : 0;
  const diskRatio = node.storage.usageRatio * 100;
  const cpuTone = meterTone(cpuNow);
  const ramTone = meterTone(ramNow);

  const status = describe(NODE_STATUS, node.status);

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle className="truncate" title={node.name}>
            {node.name}
          </CardTitle>
          <p className="mt-0.5 truncate text-2xs text-muted-foreground">
            <span className="capitalize">{node.role}</span>
            {node.lastSeenAt ? ` · vu ${formatRelative(node.lastSeenAt)}` : ''}
          </p>
        </div>
        <StatusPill tone={status.tone}>{status.label}</StatusPill>
        {labels.length > 0 && <NodeLabelBadges labels={labels} />}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <div className="flex items-center justify-between text-2xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Cpu className="h-3.5 w-3.5" />
                CPU
              </span>
              <span className={cn('tabular font-medium', cpuTone.text)}>
                {Math.round(cpuNow)} %
                <span className="ml-1 text-muted-foreground">
                  ({cpuDelta >= 0 ? '+' : ''}
                  {cpuDelta.toFixed(1)})
                </span>
              </span>
            </div>
            <Sparkline values={cpuSeries} className="mt-2 text-[hsl(var(--chart-1))]" height={40} minValue={0} maxValue={100} />
          </div>
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <div className="flex items-center justify-between text-2xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Gauge className="h-3.5 w-3.5" />
                RAM
              </span>
              <span className={cn('tabular font-medium', ramTone.text)}>{Math.round(ramNow)} %</span>
            </div>
            <Sparkline values={ramSeries} className="mt-2 text-[hsl(var(--chart-2))]" height={40} minValue={0} maxValue={100} />
          </div>
        </div>

        <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-2xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <ArrowDownToLine className="h-3 w-3" />
            <dd className="tabular">{formatThroughput(node.metrics.networkRx)}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <ArrowUpToLine className="h-3 w-3" />
            <dd className="tabular">{formatThroughput(node.metrics.networkTx)}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <HardDrive className="h-3 w-3" />
            <dd className="tabular">
              {formatCapacity(node.storage.totalUsedGb)} / {formatCapacity(node.storage.totalCapacityGb)}
              <span className="ml-1">({Math.round(diskRatio)} %)</span>
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
