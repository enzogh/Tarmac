'use client';

import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui';

const STATUS_BADGE: Record<string, { label: string; type: 'success' | 'warning' | 'error' | 'info' }> = {
  active: { label: 'Actif', type: 'success' },
  pending: { label: 'En attente', type: 'warning' },
  error: { label: 'Erreur', type: 'error' },
};

// A bare "En attente" badge reads as stuck, not in-progress - the spinner
// makes it visually obvious the agent is actively working on it (config
// push, package install, service restart...) rather than waiting on the
// user for something.
//
// `compact` trades the full badge for a plain dot when status is "active" -
// "silence = fine" for rows where most items are healthy most of the time
// (member/record rows), while pending/error still always render the full
// badge so a problem is never less visible. Defaults to false so every
// existing call site keeps today's exact appearance unless it opts in.
export function StatusIndicator({
  status,
  compact = false,
}: {
  status: 'pending' | 'active' | 'error';
  compact?: boolean;
}) {
  if (compact && status === 'active') {
    return <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" title="Actif" />;
  }
  const badge = STATUS_BADGE[status] ?? STATUS_BADGE.pending;
  return (
    <span className="inline-flex items-center gap-1.5">
      {status === 'pending' && <Loader2 className="h-3 w-3 animate-spin text-amber-400" />}
      <Badge label={badge.label} type={badge.type} />
    </span>
  );
}
