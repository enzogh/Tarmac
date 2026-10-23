'use client';

import { ReactNode } from 'react';
import { Tags } from 'lucide-react';
import { Card as ShadCard } from './ui/card';
import { Stat, type StatTone } from './ui/stat';
import { Badge as ShadBadge } from './ui/badge';
import { cn } from '../lib/utils';

// Re-exports for convenience
export { ShadCard as Card };

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  change?: string;
  changeType?: 'up' | 'down' | 'neutral';
}

/**
 * The original KPI tile, kept as a thin adapter over `Stat` so the ~45
 * existing call sites across the dashboard pages pick up the new tile
 * without each having to be rewritten. New code should use `Stat`
 * directly, which takes a semantic `tone` rather than this up/down/neutral
 * vocabulary borrowed from financial deltas.
 */
export function StatCard({ label, value, icon, change, changeType }: StatCardProps) {
  const tone: StatTone = changeType === 'up' ? 'ok' : changeType === 'down' ? 'danger' : 'neutral';
  return <Stat label={label} value={value} hint={change} iconNode={icon} tone={tone} />;
}

interface BadgeProps {
  label: string;
  type?: 'success' | 'warning' | 'error' | 'critical' | 'info';
  icon?: ReactNode;
  className?: string;
}

export function Badge({ label, type = 'info', icon, className }: BadgeProps) {
  const variantMap = {
    success: 'success',
    warning: 'warning',
    error: 'destructive',
    critical: 'critical',
    info: 'info',
  } as const;

  return (
    <ShadBadge variant={variantMap[type]} className={className}>
      {icon && <span>{icon}</span>}
      {label}
    </ShadBadge>
  );
}

export function NodeLabelBadges({ labels, className }: { labels: string[]; className?: string }) {
  if (labels.length === 0) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {labels.map((label) => (
        <span
          key={label}
          className="inline-flex items-center gap-1 rounded-full border border-violet-400/30 bg-violet-500/15 px-2 py-0.5 text-2xs text-violet-100"
        >
          <Tags className="h-3 w-3" />
          {label}
        </span>
      ))}
    </div>
  );
}

interface TableProps {
  headers: string[];
  rows: (string | number | ReactNode)[][];
}

export function Table({ headers, rows }: TableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {headers.map((header, i) => (
              <th key={i} className="px-4 py-3 text-left font-semibold text-muted-foreground text-xs">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border transition-colors hover:bg-surface-2">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-3 text-foreground/90">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
