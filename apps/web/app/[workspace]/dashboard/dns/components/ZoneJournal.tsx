'use client';

import { useEffect } from 'react';
import { Crown, Copy } from 'lucide-react';
import type { DnsServerGroupItem, DnsZoneItem, NodeItem } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusDot } from '@/components/ui/status';
import { cn } from '@/lib/utils';
import { LogStream } from './JournalLogPanel';
import { DnsJournalState } from './useDnsPageState';

/**
 * The DNS activity of the servers carrying this zone, one server at a
 * time - live, so a "Déploiement…" can be followed line by line.
 */
export function ZoneJournal({
  zone,
  group,
  nodes,
  journal,
}: {
  zone: DnsZoneItem;
  group: DnsServerGroupItem | undefined;
  nodes: NodeItem[];
  journal: DnsJournalState;
}) {
  const members = group?.members ?? [];
  const keyFor = (nodeId: string) => `zone:${zone.id}:${nodeId}`;
  const selected = members.find((member) => journal.expandedLogKey === keyFor(member.nodeId));

  // Open the primary's stream by default.
  useEffect(() => {
    const primary = members.find((member) => member.role === 'primary') ?? members[0];
    if (!selected && primary) void journal.toggleLogs(keyFor(primary.nodeId), primary.nodeId);
    // Only on entering the tab / switching zone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone.id]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Journal des serveurs DNS</CardTitle>
        <CardDescription>Messages des agents liés au DNS, en direct.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun serveur dans le groupe de ce domaine.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {members.map((member) => {
                const node = nodes.find((candidate) => candidate.id === member.nodeId);
                const active = selected?.nodeId === member.nodeId;
                return (
                  <button
                    key={member.nodeId}
                    type="button"
                    onClick={() => !active && void journal.toggleLogs(keyFor(member.nodeId), member.nodeId)}
                    aria-pressed={active}
                    className={cn(
                      'inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs transition-colors',
                      active
                        ? 'border-primary/50 bg-primary/10 font-medium text-foreground'
                        : 'border-border bg-surface-2 text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {member.role === 'primary' ? (
                      <Crown className="h-3.5 w-3.5 text-[hsl(var(--warn))]" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 text-[hsl(var(--info))]" />
                    )}
                    {node?.name ?? member.nodeId}
                    <StatusDot tone={node?.status === 'online' ? 'ok' : 'danger'} />
                  </button>
                );
              })}
            </div>
            {selected && (
              <LogStream
                entries={journal.logsByNode[selected.nodeId]}
                loading={journal.logsLoadingNodeId === selected.nodeId}
                maxHeightClass="max-h-[26rem]"
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
