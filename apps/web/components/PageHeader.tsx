import { ReactNode } from 'react';
import { cn } from '../lib/utils';

interface PageHeaderProps {
  title: ReactNode;
  description?: string;
  actions?: ReactNode;
  /** Status pills, counts or filters that belong with the title. */
  meta?: ReactNode;
  className?: string;
}

/**
 * The header is a label for the page, not a feature of it: no boxed icon,
 * no gradient fill on the title. Those cost a full band of vertical space
 * at the top of every screen and competed with the data underneath for
 * attention - the one thing a monitoring console should never do.
 */
export function PageHeader({ title, description, actions, meta, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-x-6 gap-y-3', className)}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">{title}</h1>
          {meta}
        </div>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
