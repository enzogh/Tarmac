'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Circle, Loader2, Terminal, X } from 'lucide-react';
import type { NodeInstallPhase, NodeInstallProgress } from '../lib/api';
import { cn } from '../lib/utils';
import { Progress } from './ui/progress';

export function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} min ${rest.toString().padStart(2, '0')} s` : `${minutes} min`;
}

function PhaseIcon({ status }: { status: NodeInstallPhase['status'] }) {
  if (status === 'done') {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/15">
        <Check className="h-3 w-3 text-emerald-400" />
      </span>
    );
  }
  if (status === 'running') {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15">
        <Loader2 className="h-3 w-3 animate-spin text-primary" />
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-500/15">
        <X className="h-3 w-3 text-rose-400" />
      </span>
    );
  }
  return (
    <span className="flex h-5 w-5 items-center justify-center">
      <Circle className="h-2.5 w-2.5 text-muted-foreground/40" />
    </span>
  );
}

/**
 * Live view of a node install running on the API: overall bar, the phase
 * list and the remote output as it arrives.
 */
export function NodeInstallProgressView({
  progress,
  lines,
  trackingLost,
}: {
  progress: NodeInstallProgress;
  lines: string[];
  trackingLost: boolean;
}) {
  const failed = progress.status === 'failed';
  const succeeded = progress.status === 'succeeded';
  const [showLogs, setShowLogs] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    if (failed) setShowLogs(true);
  }, [failed]);

  useEffect(() => {
    const element = logRef.current;
    if (element && stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [lines, showLogs]);

  const current = progress.phases.find((phase) => phase.status === 'running');
  const lastLine = [...lines].reverse().find((line) => line.trim().length > 0);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 truncate text-sm font-medium text-foreground">
            {succeeded
              ? `Agent installé sur ${progress.nodeName}`
              : failed
                ? `L’installation sur ${progress.nodeName} a échoué`
                : current
                  ? `${current.label}…`
                  : `Installation sur ${progress.nodeName}…`}
          </p>
          <p className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
            {progress.percent} % · {formatDuration(progress.elapsedMs)}
          </p>
        </div>
        <Progress
          value={progress.percent}
          indicatorClassName={cn(failed && 'from-rose-500 to-rose-400', succeeded && 'from-emerald-500 to-emerald-400')}
        />
        {!failed && !succeeded && lastLine && (
          <p className="truncate font-mono text-[11px] text-muted-foreground/80" title={lastLine}>
            {lastLine}
          </p>
        )}
      </div>

      <ol className="space-y-1 rounded-xl border border-border bg-zinc-900/40 p-2">
        {progress.phases.map((phase) => (
          <li
            key={phase.id}
            className={cn(
              'flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm',
              phase.status === 'running' && 'bg-primary/[0.06]',
              phase.status === 'pending' && 'text-muted-foreground',
              phase.status === 'error' && 'text-rose-300',
            )}
          >
            <PhaseIcon status={phase.status} />
            <span className="min-w-0 flex-1 truncate">{phase.label}</span>
            {phase.durationMs !== null && phase.status !== 'pending' && (
              <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{formatDuration(phase.durationMs)}</span>
            )}
          </li>
        ))}
      </ol>

      {progress.warning && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{progress.warning}</span>
        </div>
      )}
      {progress.error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="whitespace-pre-wrap break-words">{progress.error}</span>
        </div>
      )}
      {trackingLost && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Le suivi de l’installation n’est plus disponible (le panel a probablement redémarré). L’installation a pu se terminer :
            vérifiez l’état du nœud dans la liste.
          </span>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border">
        <button
          type="button"
          onClick={() => setShowLogs((value) => !value)}
          className="flex w-full items-center gap-2 bg-zinc-900/60 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
          aria-expanded={showLogs}
        >
          <Terminal className="h-3.5 w-3.5" />
          <span className="flex-1 font-medium">Journal {progress.status === 'running' ? 'en direct' : 'de l’installation'}</span>
          {progress.status === 'running' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" aria-hidden />}
          <span className="tabular-nums">{lines.length} lignes</span>
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showLogs && 'rotate-180')} />
        </button>
        {showLogs && (
          <pre
            ref={logRef}
            onScroll={(event) => {
              const element = event.currentTarget;
              stickToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
            }}
            className="max-h-64 overflow-auto bg-zinc-950/80 p-3 font-mono text-[11px] leading-relaxed text-zinc-300"
          >
            {lines.length ? lines.join('\n') : 'En attente de la sortie du serveur…'}
          </pre>
        )}
      </div>
    </div>
  );
}
