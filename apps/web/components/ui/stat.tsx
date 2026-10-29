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

// The icon sits in a small chip tinted with the tile's tone: a quiet way to
// say "this one needs a look" that still reads in a row of five.
const TONE_CHIP: Record<StatTone, string> = {
  neutral: 'border-white/[0.06] bg-white/[0.03] text-muted-foreground',
  ok: 'border-[hsl(var(--ok))]/20 bg-[hsl(var(--ok))]/10 text-[hsl(var(--ok))]',
  warn: 'border-[hsl(var(--warn))]/20 bg-[hsl(var(--warn))]/10 text-[hsl(var(--warn))]',
  danger: 'border-[hsl(var(--danger))]/25 bg-[hsl(var(--danger))]/10 text-[hsl(var(--danger))]',
  info: 'border-[hsl(var(--info))]/20 bg-[hsl(var(--info))]/10 text-[hsl(var(--info))]',
};

// A faint wash of the tone in the tile's corner, only when it carries news.
const TONE_GLOW: Record<StatTone, string | null> = {
  neutral: null,
  ok: null,
  warn: 'bg-[hsl(var(--warn))]',
  danger: 'bg-[hsl(var(--danger))]',
  info: null,
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
        'group relative flex min-w-0 flex-col justify-between gap-4 overflow-hidden rounded-xl border border-border bg-surface-1 [background-image:linear-gradient(180deg,rgba(255,255,255,0.03),transparent_45%)] p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] transition-[border-color,transform] duration-300 hover:border-white/[0.12]',
        className,
      )}
    >
      {TONE_GLOW[tone] && (
        <span className={cn('pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-[0.12] blur-2xl', TONE_GLOW[tone])} aria-hidden />
      )}
      <div className="relative flex items-start justify-between gap-3">
        {/* No reserved second line here: the tiles sit in a grid, so they
            already stretch to a common height, and `justify-between` drops
            every value to the bottom of that height - the figures line up
            across the row whether or not one label wraps. */}
        <p className="pt-1 text-[13px] font-medium leading-4 text-muted-foreground">{label}</p>
        {(Icon || iconNode) && (
          <span
            className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border [&>svg]:h-3.5 [&>svg]:w-3.5',
              TONE_CHIP[tone],
            )}
            aria-hidden
          >
            {Icon ? <Icon /> : iconNode}
          </span>
        )}
      </div>
      <div className="relative min-w-0">
        <p className="flex items-baseline gap-1.5 truncate">
          <span className={cn('tabular text-[1.75rem] font-semibold leading-none tracking-tight', TONE_TEXT[tone])}>
            {value}
          </span>
          {unit && <span className="text-sm font-medium text-muted-foreground">{unit}</span>}
        </p>
        {hint && <p className="mt-2 truncate text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

/** A row of Stat tiles that keeps the same rhythm on every page. */
export function StatRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('stagger-in grid grid-cols-2 gap-3 xl:grid-cols-4', className)}>{children}</div>
  );
}
