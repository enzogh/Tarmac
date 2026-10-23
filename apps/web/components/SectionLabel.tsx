import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

/**
 * Separates bands of a page. It used to be violet, small-caps and letter-
 * spaced to 0.2em, which gave a label with no information in it more visual
 * weight than the figures underneath. It is now a quiet rule with a title.
 */
export function SectionLabel({
  children,
  actions,
  className,
}: {
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-4', className)}>
      <h2 className="shrink-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</h2>
      <span className="h-px flex-1 bg-border" aria-hidden />
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
