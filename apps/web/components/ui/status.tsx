'use client';

import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export type StatusTone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral' | 'accent';

const DOT: Record<StatusTone, string> = {
  ok: 'bg-[hsl(var(--ok))]',
  warn: 'bg-[hsl(var(--warn))]',
  danger: 'bg-[hsl(var(--danger))]',
  info: 'bg-[hsl(var(--info))]',
  neutral: 'bg-[hsl(var(--neutral))]',
  accent: 'bg-primary',
};

const PILL: Record<StatusTone, string> = {
  ok: 'border-[hsl(var(--ok))]/25 bg-[hsl(var(--ok))]/10 text-[hsl(var(--ok))]',
  warn: 'border-[hsl(var(--warn))]/25 bg-[hsl(var(--warn))]/10 text-[hsl(var(--warn))]',
  danger: 'border-[hsl(var(--danger))]/25 bg-[hsl(var(--danger))]/10 text-[hsl(var(--danger))]',
  info: 'border-[hsl(var(--info))]/25 bg-[hsl(var(--info))]/10 text-[hsl(var(--info))]',
  neutral: 'border-border bg-surface-2 text-muted-foreground',
  accent: 'border-primary/30 bg-primary/10 text-primary',
};

/**
 * A status dot. Colour alone can't carry meaning for everyone, so this is
 * always rendered next to its own label rather than on its own in a cell.
 */
export function StatusDot({ tone, pulse, className }: { tone: StatusTone; pulse?: boolean; className?: string }) {
  return (
    <span className={cn('relative flex h-2 w-2 shrink-0', className)} aria-hidden>
      {pulse && (
        <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', DOT[tone])} />
      )}
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', DOT[tone])} />
    </span>
  );
}

/** Compact labelled status, for table cells and card headers. */
export function StatusPill({
  tone,
  children,
  dot = true,
  className,
}: {
  tone: StatusTone;
  children: ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-2xs font-medium',
        PILL[tone],
        className,
      )}
    >
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', DOT[tone])} aria-hidden />}
      {children}
    </span>
  );
}

// --- Domain vocabularies -------------------------------------------------
// The API speaks English enums; the interface is French. Mapping both the
// tone and the wording in one place is what stops "open"/"degraded"/"medium"
// leaking into the UI untranslated, as they previously did on the alerts
// and infrastructure pages.

export const NODE_STATUS: Record<string, { tone: StatusTone; label: string }> = {
  online: { tone: 'ok', label: 'En ligne' },
  degraded: { tone: 'warn', label: 'Dégradé' },
  offline: { tone: 'danger', label: 'Hors ligne' },
};

export const SEVERITY: Record<string, { tone: StatusTone; label: string }> = {
  low: { tone: 'info', label: 'Faible' },
  medium: { tone: 'warn', label: 'Moyenne' },
  high: { tone: 'danger', label: 'Élevée' },
  critical: { tone: 'danger', label: 'Critique' },
};

export const ALERT_STATUS: Record<string, { tone: StatusTone; label: string }> = {
  open: { tone: 'danger', label: 'Ouverte' },
  acknowledged: { tone: 'warn', label: 'Prise en compte' },
  resolved: { tone: 'ok', label: 'Résolue' },
};

export const RESOURCE_STATUS: Record<string, { tone: StatusTone; label: string }> = {
  active: { tone: 'ok', label: 'Actif' },
  pending: { tone: 'warn', label: 'En attente' },
  error: { tone: 'danger', label: 'Erreur' },
  running: { tone: 'info', label: 'En cours' },
  success: { tone: 'ok', label: 'Réussi' },
  failed: { tone: 'danger', label: 'Échoué' },
  completed: { tone: 'ok', label: 'Terminé' },
  healthy: { tone: 'ok', label: 'Sain' },
  warning: { tone: 'warn', label: 'Alerte' },
  critical: { tone: 'danger', label: 'Critique' },
  unknown: { tone: 'neutral', label: 'Inconnu' },
  offline: { tone: 'danger', label: 'Hors ligne' },
  degraded: { tone: 'warn', label: 'Dégradé' },
};

/** Falls back to the raw value rather than hiding an enum we don't know. */
export function describe(
  vocabulary: Record<string, { tone: StatusTone; label: string }>,
  value: string | null | undefined,
): { tone: StatusTone; label: string } {
  if (!value) return { tone: 'neutral', label: '—' };
  return vocabulary[value] ?? { tone: 'neutral', label: value };
}
