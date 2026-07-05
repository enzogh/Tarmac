'use client';

import { ReactNode } from 'react';
import { Card as ShadCard, CardContent, CardHeader, CardTitle } from './ui/card';
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

export function StatCard({ label, value, icon, change, changeType }: StatCardProps) {
  return (
    <ShadCard className="bg-panel-glow">
      <CardContent className="pt-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{value}</p>
            {change && (
              <p
                className={cn(
                  'mt-2 text-xs font-medium',
                  changeType === 'up'
                    ? 'text-emerald-400'
                    : changeType === 'down'
                      ? 'text-rose-400'
                      : 'text-muted-foreground'
                )}
              >
                {change}
              </p>
            )}
          </div>
          {icon && (
            <div className="text-muted-foreground opacity-70">{icon}</div>
          )}
        </div>
      </CardContent>
    </ShadCard>
  );
}

interface BadgeProps {
  label: string;
  type?: 'success' | 'warning' | 'error' | 'info';
  icon?: ReactNode;
}

export function Badge({ label, type = 'info', icon }: BadgeProps) {
  const variantMap = {
    success: 'success',
    warning: 'warning',
    error: 'destructive',
    info: 'info',
  } as const;

  return (
    <ShadBadge variant={variantMap[type]}>
      {icon && <span>{icon}</span>}
      {label}
    </ShadBadge>
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
          <tr className="border-b border-white/[0.08]">
            {headers.map((header, i) => (
              <th key={i} className="px-4 py-3 text-left font-semibold text-muted-foreground text-xs">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-white/[0.06] transition-colors hover:bg-white/[0.02]">
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
