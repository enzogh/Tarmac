import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * What a list shows before it has anything in it: what goes here, and the
 * one action that fills it. Same look on every page, so an empty screen
 * reads as "start here" rather than "something failed to load".
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <span className="relative mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-gradient-to-b from-white/[0.06] to-white/[0.01] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
        <span className="absolute inset-0 -z-10 rounded-2xl bg-primary/20 blur-xl" aria-hidden />
        <Icon className="h-5 w-5 text-primary" aria-hidden />
      </span>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}
