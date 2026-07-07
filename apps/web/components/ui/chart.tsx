'use client';

import * as React from 'react';
import * as RechartsPrimitive from 'recharts';
import { cn } from '@/lib/utils';

export type ChartConfig = Record<
  string,
  {
    label: string;
    color: string;
  }
>;

type ChartContextValue = { config: ChartConfig };

const ChartContext = React.createContext<ChartContextValue | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) {
    throw new Error('Chart components must be used within a <ChartContainer />');
  }
  return context;
}

function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const rules = Object.entries(config)
    .map(([key, item]) => `--color-${key}: ${item.color};`)
    .join(' ');

  if (!rules) return null;

  return <style>{`[data-chart="${id}"] { ${rules} }`}</style>;
}

interface ChartContainerProps extends React.ComponentProps<'div'> {
  config: ChartConfig;
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>['children'];
}

export function ChartContainer({ id, className, children, config, ...props }: ChartContainerProps) {
  const uniqueId = React.useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, '')}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-chart={chartId}
        className={cn('h-full w-full text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground', className)}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

export const ChartTooltip = RechartsPrimitive.Tooltip;

interface ChartTooltipContentProps {
  active?: boolean;
  label?: string | number;
  payload?: Array<{ dataKey?: string | number; name?: string | number; value?: number; color?: string }>;
  valueFormatter?: (value: number, dataKey: string) => string;
}

export function ChartTooltipContent({ active, label, payload, valueFormatter }: ChartTooltipContentProps) {
  const { config } = useChart();

  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-xl border border-white/[0.08] bg-zinc-950/95 px-3 py-2 text-xs shadow-panel backdrop-blur-xl">
      {label !== undefined && <p className="mb-1.5 font-medium text-foreground">{label}</p>}
      <div className="space-y-1">
        {payload.map((item) => {
          const key = String(item.dataKey ?? item.name ?? '');
          const entry = config[key];
          return (
            <div key={key} className="flex items-center gap-2">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: item.color ?? entry?.color }}
              />
              <span className="text-muted-foreground">{entry?.label ?? key}</span>
              <span className="ml-auto font-mono font-medium text-foreground">
                {item.value !== undefined
                  ? valueFormatter
                    ? valueFormatter(item.value, key)
                    : item.value
                  : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
