'use client';

import { useMemo, useState } from 'react';
import { ChevronRight, Globe, Search, ShieldCheck } from 'lucide-react';
import type { DnsServerGroupItem, DnsZoneItem } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { StatusPill } from '@/components/ui/status';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { zoneHealth } from './dns-ui';

const HEALTH_RANK = { error: 0, pending: 1, 'awaiting-ns': 2, active: 3 } as const;

/** Every domain of the workspace; a row opens that domain's dashboard. */
export function ZoneList({
  zones,
  groups,
  onOpen,
}: {
  zones: DnsZoneItem[];
  groups: DnsServerGroupItem[];
  onOpen: (zoneId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return zones
      .filter((zone) => !needle || zone.name.includes(needle))
      .sort(
        (left, right) =>
          HEALTH_RANK[zoneHealth(left).key] - HEALTH_RANK[zoneHealth(right).key] || left.name.localeCompare(right.name),
      );
  }, [zones, query]);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 lg:px-5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher un domaine…"
            className="h-8 w-64 pl-8"
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {zones.length} domaine{zones.length > 1 ? 's' : ''} ·{' '}
          {zones.filter((zone) => zoneHealth(zone).key === 'active').length} actif(s)
        </span>
      </div>
      <ul className="divide-y divide-border">
        {visible.map((zone) => {
          const health = zoneHealth(zone);
          const group = groups.find((candidate) => candidate.id === zone.groupId);
          return (
            <li key={zone.id}>
              <button
                type="button"
                onClick={() => onOpen(zone.id)}
                className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-surface-2/60 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_minmax(0,1fr)_auto] lg:px-5"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2">
                    <Globe className="h-4 w-4 text-muted-foreground" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{zone.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {zone.records.length} enregistrement{zone.records.length > 1 ? 's' : ''}
                    </span>
                  </span>
                </span>
                <span className="hidden sm:block">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <StatusPill tone={health.tone}>{health.label}</StatusPill>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">{health.hint}</TooltipContent>
                  </Tooltip>
                </span>
                <span className="hidden min-w-0 items-center gap-3 text-xs text-muted-foreground sm:flex">
                  <span className="truncate">{group?.name ?? '—'}</span>
                  {zone.dnssecEnabled && (
                    <span className="inline-flex shrink-0 items-center gap-1 text-[hsl(var(--ok))]">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      DNSSEC
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  <span className="sm:hidden">
                    <StatusPill tone={health.tone}>{health.label}</StatusPill>
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </span>
              </button>
            </li>
          );
        })}
        {visible.length === 0 && (
          <li className="px-4 py-10 text-center text-sm text-muted-foreground">Aucun domaine ne correspond à « {query} ».</li>
        )}
      </ul>
    </Card>
  );
}
