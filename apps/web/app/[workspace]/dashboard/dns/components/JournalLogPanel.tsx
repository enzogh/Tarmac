'use client';

import { DnsJournalState } from './useDnsPageState';

// Recent DNS-related agent-log entries for a node, toggled per group-member
// or zone row (mirrors the SMART-history expand pattern on the
// infrastructure page). Shared by GroupsSection and ZonesSection.
export function JournalLogPanel({ journal, panelKey, nodeId }: { journal: DnsJournalState; panelKey: string; nodeId: string }) {
  if (journal.expandedLogKey !== panelKey) return null;
  const entries = journal.logsByNode[nodeId];
  return (
    <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-white/[0.08] bg-zinc-950/70 p-2.5 font-mono text-xs">
      {journal.logsLoadingNodeId === nodeId ? (
        <p className="text-muted-foreground">Chargement…</p>
      ) : !entries || entries.length === 0 ? (
        <p className="text-muted-foreground">Aucun log DNS pour ce nœud pour l'instant.</p>
      ) : (
        entries.map((entry) => (
          <div key={entry.id} className="flex gap-2">
            <span className="shrink-0 text-muted-foreground">
              {new Date(entry.createdAt).toLocaleTimeString('fr-FR')}
            </span>
            <span className={entry.level === 'error' || entry.level === 'critical' ? 'text-rose-300' : 'text-zinc-300'}>
              {entry.message}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
