'use client';

import { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { areaOfPath, isRestrictedToRead, useWorkspaceAccess } from '../lib/access';
import { cn } from '../lib/utils';

interface PageHeaderProps {
  title: ReactNode;
  description?: string;
  actions?: ReactNode;
  /** Status pills, counts or filters that belong with the title. */
  meta?: ReactNode;
  className?: string;
  /** Header actions are hidden from read-only members; keep them when they only navigate. */
  actionsReadOnlySafe?: boolean;
}

/**
 * The header is a label for the page, not a feature of it: no boxed icon,
 * no gradient fill on the title. Those cost a full band of vertical space
 * at the top of every screen and competed with the data underneath for
 * attention - the one thing a monitoring console should never do.
 */
export function PageHeader({ title, description, actions, meta, className, actionsReadOnlySafe }: PageHeaderProps) {
  // A page's header actions create or change things (onboard a node, new
  // share, new zone...): a read-only member would only meet a refusal.
  const area = areaOfPath(usePathname() ?? '');
  const access = useWorkspaceAccess(area !== null);
  const readOnly = area !== null && access.ready && isRestrictedToRead(area, access.level(area));
  if (readOnly && !actionsReadOnlySafe) actions = undefined;
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-x-6 gap-y-3 pb-1', className)}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {meta}
        </div>
        {description && <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
