'use client';

import { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

export type StatTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info';

const TONE_TEXT: Record<StatTone, string> = {
  neutral: 'text-foreground',
  ok: 'text-[hsl(var(--ok))]',
  warn: 'text-[hsl(var(--warn))]',
  danger: 'text-[hsl(var(--danger))]',
  info: 'text-[hsl(var(--info))]',
};

const TONE_RAIL: Record<StatTone, string> = {
  neutral: 'bg-border',
  ok: 'bg-[hsl(var(--ok))]',
  warn: 'bg-[hsl(var(--warn))]',
  danger: 'bg-[hsl(var(--danger))]',
  info: 'bg-[hsl(var(--info))]',
};

export type StatProps = {
  label: string;
  value: ReactNode;
  /** Rendered small and muted right after the value, e.g. "GB", "/ 7". */
  unit?: string;
  /** One line of context under the value, e.g. "44 604 GB au total". */
  hint?: ReactNode;
  icon?: LucideIcon;
  /** Escape hatch for callers that already hold a rendered icon element. */
  iconNode?: ReactNode;
  /** Colours the value and the left rail. Default stays neutral. */
  tone?: StatTone;
  className?: string;
};

/**
 * The single KPI tile used across every page. The previous one gave the
 * label and the value near-equal weight and let the value wrap mid-number
 * ("32693" / "GB" on two lines), so a row of four tiles came out ragged and
 * hard to scan. Here the label is small, the figure is the only large thing,
 * and its unit is a separate muted span that can't break the number across
 * lines.
 */
export function Stat({ label, value, unit, hint, icon: Icon, iconNode, tone = 'neutral', className }: StatProps) {
  return (
    <div
      className={cn(
        'relative flex min-w-0 flex-col justify-between gap-3 overflow-hidden rounded-xl border border-border bg-surface-1 [background-image:linear-gradient(180deg,rgba(255,255,255,0.025),transparent_40%)] p-4 transition-[border-color,background-color] duration-300 hover:border-white/[0.12] hover:bg-surface-1/80',
        className,
      )}
    >
      <span className={cn('absolute inset-y-0 left-0 w-px', TONE_RAIL[tone])} aria-hidden />
      <div className="flex items-start justify-between gap-3">
        {/* No reserved second line here: the tiles sit in a grid, so they
            already stretch to a common height, and `justify-between` already
            drops every value to the bottom of that height - the figures line
            up across the row whether or not one label wraps. The reserved
            line only ever added 16px of dead air between a one-line label and
            its figure, which is the usual case. */}
        <p className="text-2xs font-medium uppercase leading-4 tracking-wider text-muted-foreground">
          {label}
        </p>
        {Icon ? (
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
        ) : (
          iconNode && (
            <span className="shrink-0 text-muted-foreground/60 [&>svg]:h-4 [&>svg]:w-4" aria-hidden>
              {iconNode}
            </span>
          )
        )}
      </div>
      <div className="min-w-0">
        <p className="flex items-baseline gap-1.5 truncate">
          <span className={cn('tabular text-[1.75rem] font-semibold leading-none tracking-tight', TONE_TEXT[tone])}>
            {value}
          </span>
          {unit && <span className="text-sm font-medium text-muted-foreground">{unit}</span>}
        </p>
        {hint && <p className="mt-1.5 truncate text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

/** A row of Stat tiles that keeps the same rhythm on every page. */
export function StatRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('stagger-in grid gap-3 sm:grid-cols-2 xl:grid-cols-4', className)}>{children}</div>
  );
}
