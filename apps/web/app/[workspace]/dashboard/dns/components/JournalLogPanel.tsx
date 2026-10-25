'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ScrollText } from 'lucide-react';
import type { AgentLogItem } from '@/lib/api';
import { cn } from '@/lib/utils';
import { DnsJournalState } from './useDnsPageState';

// How close to the bottom (px) still counts as "following" the stream.
const STICK_THRESHOLD_PX = 24;

/**
 * A live agent log stream, read like a chat: oldest at the top, newest at
 * the bottom, and it stays pinned to the bottom while you're there. It used
 * to render newest-first in a box with the browser's raw scrollbar, so
 * every live line pushed what you were reading down, the wheel spilled over
 * into scrolling the whole page once the box hit its end, and the default
 * scrollbar (framed in the page background colour) clashed with the dark
 * inset. Scrolling up now pauses the follow and offers a jump back down.
 */
export function LogStream({
  entries,
  loading,
  emptyLabel = 'Aucun message DNS pour ce nœud pour l’instant.',
  maxHeightClass = 'max-h-72',
  className,
}: {
  /** Newest first, as the API and the live socket deliver them. */
  entries: AgentLogItem[] | undefined;
  loading?: boolean;
  emptyLabel?: string;
  maxHeightClass?: string;
  className?: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const lastCount = useRef(0);
  const chronological = entries ? [...entries].reverse() : [];

  // Runs before paint so a new line never flashes in above the fold first.
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const added = chronological.length - lastCount.current;
    lastCount.current = chronological.length;
    if (following) {
      el.scrollTop = el.scrollHeight;
    } else if (added > 0) {
      setUnseen((count) => count + added);
    }
    // Only the number of lines matters here, not their identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chronological.length, following]);

  // A different node / reload starts following again from the bottom.
  useEffect(() => {
    if (loading) {
      setFollowing(true);
      setUnseen(0);
      lastCount.current = 0;
    }
  }, [loading]);

  const onScroll = () => {
    const el = viewport.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_THRESHOLD_PX;
    setFollowing(atBottom);
    if (atBottom) setUnseen(0);
  };

  const jumpToLatest = () => {
    const el = viewport.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setFollowing(true);
    setUnseen(0);
  };

  return (
    <div className={cn('relative overflow-hidden rounded-lg border border-border bg-background/60', className)}>
      <div
        ref={viewport}
        onScroll={onScroll}
        className={cn(
          'scroll-thin min-h-[7rem] overscroll-y-contain overflow-y-auto overflow-x-hidden px-3 py-2 font-mono text-xs leading-relaxed',
          maxHeightClass,
        )}
      >
        {loading ? (
          <p className="py-6 text-center text-muted-foreground">Chargement…</p>
        ) : chronological.length === 0 ? (
          <p className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <ScrollText className="h-3.5 w-3.5" />
            {emptyLabel}
          </p>
        ) : (
          chronological.map((entry) => {
            const isError = entry.level === 'error' || entry.level === 'critical';
            return (
              <div key={entry.id} className="flex gap-3 py-0.5">
                <time className="shrink-0 tabular-nums text-muted-foreground/70" dateTime={entry.createdAt}>
                  {new Date(entry.createdAt).toLocaleTimeString('fr-FR')}
                </time>
                <span className={cn('min-w-0 break-words', isError ? 'text-[hsl(var(--danger))]' : 'text-foreground/85')}>
                  {entry.message}
                </span>
              </div>
            );
          })
        )}
      </div>
      {!following && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-2 left-1/2 inline-flex -translate-x-1/2 animate-fade-in items-center gap-1.5 rounded-full border border-border bg-popover px-3 py-1 text-2xs font-medium text-foreground shadow-overlay hover:bg-surface-3"
        >
          <ArrowDown className="h-3 w-3" />
          {unseen > 0 ? `${unseen} nouveau${unseen > 1 ? 'x' : ''} message${unseen > 1 ? 's' : ''}` : 'Revenir au plus récent'}
        </button>
      )}
    </div>
  );
}

// Toggled per server row on the "Serveurs DNS" tab (shared journal state,
// see useDnsPageState).
export function JournalLogPanel({ journal, panelKey, nodeId }: { journal: DnsJournalState; panelKey: string; nodeId: string }) {
  if (journal.expandedLogKey !== panelKey) return null;
  return (
    <LogStream
      entries={journal.logsByNode[nodeId]}
      loading={journal.logsLoadingNodeId === nodeId}
      className="mt-2"
    />
  );
}
