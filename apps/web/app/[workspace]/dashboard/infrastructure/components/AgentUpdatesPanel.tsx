'use client';

import { useEffect, useState } from 'react';
import { Check, CircleAlert, Clock3, Hammer, LoaderCircle, Power, RefreshCcw, X } from 'lucide-react';
import type { AgentUpdateStatus, NodeActivityItem } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

// How long a finished update stays listed, so the result is seen.
const KEEP_FINISHED_MS = 30 * 60 * 1000;
// "Masquer" survives a reload or coming back to the page: updates finished
// before this instant stay hidden.
const DISMISSED_STORAGE_KEY = 'tarmac.agentUpdates.dismissedAt';

const STEPS: { status: AgentUpdateStatus; label: string; icon: typeof Hammer }[] = [
  { status: 'sent', label: 'Téléchargement et compilation', icon: Hammer },
  { status: 'restarting', label: 'Redémarrage', icon: Power },
  { status: 'done', label: 'À jour', icon: Check },
];

const inProgress = (status: AgentUpdateStatus) => status === 'sent' || status === 'restarting';

function elapsed(from: string | null, to: string | null, now: number) {
  if (!from) return '';
  const seconds = Math.max(0, Math.round(((to ? new Date(to).getTime() : now) - new Date(from).getTime()) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${String(seconds % 60).padStart(2, '0')} s`;
}

/**
 * Live progress of the agent updates asked from this page: one line per node,
 * a three-step track, and in plain words why one failed - instead of a
 * "mise à jour lancée" that never says whether anything happened.
 */
export function AgentUpdatesPanel({ nodes, onRetry }: { nodes: NodeActivityItem[]; onRetry: (node: NodeActivityItem) => void }) {
  const [now, setNow] = useState(() => Date.now());
  const [dismissedAt, setDismissedAt] = useState(0);
  useEffect(() => {
    try {
      const stored = Number(localStorage.getItem(DISMISSED_STORAGE_KEY));
      if (Number.isFinite(stored) && stored > 0) setDismissedAt(stored);
    } catch {
      // Storage unavailable (private window): dismissal lasts for this visit only.
    }
  }, []);
  const dismiss = () => {
    const at = Date.now();
    setDismissedAt(at);
    try {
      localStorage.setItem(DISMISSED_STORAGE_KEY, String(at));
    } catch {
      // Same as above.
    }
  };

  const tracked = nodes
    .filter((node) => {
      const update = node.agentUpdate;
      if (!update?.startedAt) return false;
      if (inProgress(update.status)) return true;
      const finished = new Date(update.finishedAt ?? update.startedAt).getTime();
      return now - finished < KEEP_FINISHED_MS && finished > dismissedAt;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const running = tracked.filter((node) => inProgress(node.agentUpdate!.status)).length;
  useEffect(() => {
    if (tracked.length === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [tracked.length]);

  if (tracked.length === 0) return null;
  const done = tracked.filter((node) => node.agentUpdate!.status === 'done').length;
  const failed = tracked.filter((node) => ['failed', 'timeout'].includes(node.agentUpdate!.status)).length;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', running > 0 ? 'bg-primary/10 text-primary' : failed > 0 ? 'bg-[hsl(var(--danger))]/10 text-[hsl(var(--danger))]' : 'bg-[hsl(var(--ok))]/10 text-[hsl(var(--ok))]')}>
          {running > 0 ? <RefreshCcw className="h-4 w-4 animate-spin [animation-duration:2.5s]" /> : failed > 0 ? <CircleAlert className="h-4 w-4" /> : <Check className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">Mises à jour des agents</p>
          <p className="text-xs text-muted-foreground">
            {[running > 0 && `${running} en cours`, done > 0 && `${done} terminée${done > 1 ? 's' : ''}`, failed > 0 && `${failed} en échec`].filter(Boolean).join(' · ')}
            {running > 0 && ' — la page se met à jour toute seule.'}
          </p>
        </div>
        {running === 0 && (
          <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={dismiss}>
            <X className="h-3.5 w-3.5" />
            Masquer
          </Button>
        )}
      </div>
      <ul className="divide-y divide-border">
        {tracked.map((node) => {
          const update = node.agentUpdate!;
          const failedState = update.status === 'failed' || update.status === 'timeout';
          const reached = update.status === 'done' ? 3 : update.status === 'restarting' ? 1 : 0;
          return (
            <li key={node.id} className="space-y-2.5 px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-sm text-foreground">{node.name}</span>
                <span className="text-2xs text-muted-foreground">
                  {update.fromVersion ?? '?'} → {update.toVersion ?? 'dernière version'}
                </span>
                <span className="flex-1" />
                <span className="inline-flex items-center gap-1 text-2xs tabular-nums text-muted-foreground">
                  <Clock3 className="h-3 w-3" />
                  {elapsed(update.startedAt, inProgress(update.status) ? null : update.finishedAt, now)}
                </span>
                {failedState && (
                  <Button variant="secondary" size="sm" className="h-7 gap-1 text-xs" disabled={node.status !== 'online'} onClick={() => onRetry(node)}>
                    <RefreshCcw className="h-3 w-3" />
                    Réessayer
                  </Button>
                )}
              </div>

              <ol className="flex items-center gap-1.5" aria-label={`Progression de ${node.name}`}>
                {STEPS.map((step, index) => {
                  const complete = index < reached || update.status === 'done';
                  const current = !failedState && index === reached && update.status !== 'done';
                  const broken = failedState && index === reached;
                  const Icon = broken ? CircleAlert : current ? LoaderCircle : step.icon;
                  return (
                    <li key={step.status} className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span
                        className={cn(
                          'flex min-w-0 flex-1 items-center gap-1.5 rounded-md border px-2 py-1 text-2xs',
                          complete && 'border-[hsl(var(--ok))]/30 bg-[hsl(var(--ok))]/10 text-[hsl(var(--ok))]',
                          current && 'border-primary/40 bg-primary/10 text-primary',
                          broken && 'border-[hsl(var(--danger))]/30 bg-[hsl(var(--danger))]/10 text-[hsl(var(--danger))]',
                          !complete && !current && !broken && 'border-border text-muted-foreground/70',
                        )}
                      >
                        <Icon className={cn('h-3 w-3 shrink-0', current && 'animate-spin')} />
                        <span className="truncate">{broken ? (update.status === 'timeout' ? 'Sans réponse' : 'Échec') : step.label}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>

              {failedState && update.message && (
                <p className="rounded-md border border-[hsl(var(--danger))]/20 bg-[hsl(var(--danger))]/5 px-3 py-2 text-xs leading-relaxed text-foreground/90">{update.message}</p>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
