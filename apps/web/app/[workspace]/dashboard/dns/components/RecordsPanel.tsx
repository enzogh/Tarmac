'use client';

import { Fragment, useMemo, useState } from 'react';
import { ChevronRight, ListPlus, MapPin, Plus, Search } from 'lucide-react';
import type { DnsRecordItem, DnsRecordType, DnsZoneItem, NodeItem } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusDot } from '@/components/ui/status';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { flagFromCountryCode } from '@/lib/geo';
import { cn } from '@/lib/utils';
import { formatTtl, RECORD_TYPE_ORDER, RECORD_TYPES, RecordTypeBadge, sortRecords } from './dns-ui';
import { RecordEditor } from './RecordEditor';

const RECORD_STATUS = {
  active: { tone: 'ok' as const, label: 'Appliqué sur les serveurs' },
  pending: { tone: 'warn' as const, label: 'En cours de déploiement' },
  error: { tone: 'danger' as const, label: "Échec d'application" },
};

function RecordName({ name, zone }: { name: string; zone: string }) {
  if (name === '@') return <span className="font-medium text-foreground">{zone}</span>;
  return (
    <span className="break-all">
      <span className="font-medium text-foreground">{name}</span>
      <span className="text-muted-foreground">.{zone}</span>
    </span>
  );
}

function RecordContent({ record, nodes }: { record: DnsRecordItem; nodes: NodeItem[] }) {
  const usesPriority = RECORD_TYPES[record.type]?.usesPriority;
  return (
    <div className="min-w-0 space-y-0.5">
      {record.values.map((value, index) => {
        const node = value.nodeId ? nodes.find((candidate) => candidate.id === value.nodeId) : undefined;
        return (
          <div key={value.id ?? index} className="flex min-w-0 items-center gap-2">
            {usesPriority && value.priority != null && (
              <span className="shrink-0 rounded bg-surface-3 px-1.5 font-mono text-2xs text-muted-foreground">{value.priority}</span>
            )}
            <span className="min-w-0 truncate font-mono text-xs text-foreground/90" title={value.content}>
              {value.content}
            </span>
            {node && (
              <span className="inline-flex shrink-0 items-center gap-1 text-2xs text-muted-foreground">
                {flagFromCountryCode(node.locationCountryCode)} {node.name}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The records of one zone, Cloudflare-style: one row per RRset, filterable,
 * and edited in place - clicking a row opens its editor right under it.
 */
export function RecordsPanel({
  zone,
  nodes,
  onChanged,
  onNotice,
}: {
  zone: DnsZoneItem;
  nodes: NodeItem[];
  onChanged: () => Promise<unknown>;
  onNotice: (notice: { type: 'success' | 'error'; message: string }) => void;
}) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | DnsRecordType>('all');
  // 'new' = the add form at the top, a record id = that row's inline editor.
  const [editing, setEditing] = useState<string | null>(null);

  const presentTypes = useMemo(
    () => RECORD_TYPE_ORDER.filter((type) => zone.records.some((record) => record.type === type)),
    [zone.records],
  );
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return sortRecords(zone.records).filter((record) => {
      if (typeFilter !== 'all' && record.type !== typeFilter) return false;
      if (!needle) return true;
      const full = record.name === '@' ? zone.name : `${record.name}.${zone.name}`;
      return (
        full.toLowerCase().includes(needle) ||
        record.values.some((value) => value.content.toLowerCase().includes(needle))
      );
    });
  }, [zone.records, zone.name, query, typeFilter]);

  const done = async (message: string) => {
    setEditing(null);
    onNotice({ type: 'success', message });
    await onChanged();
  };
  const fail = (message: string) => onNotice({ type: 'error', message });

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 lg:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Nom ou valeur…"
              className="h-8 w-52 pl-8"
            />
          </div>
          <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as 'all' | DnsRecordType)}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les types</SelectItem>
              {presentTypes.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {visible.length === zone.records.length
              ? `${zone.records.length} enregistrement${zone.records.length > 1 ? 's' : ''}`
              : `${visible.length} sur ${zone.records.length}`}
          </span>
        </div>
        <Button onClick={() => setEditing('new')} disabled={editing === 'new'} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Ajouter un enregistrement
        </Button>
      </div>

      {editing === 'new' && (
        <div className="border-b border-border p-4 lg:px-5">
          <RecordEditor
            zoneId={zone.id}
            zoneName={zone.name}
            nodes={nodes}
            onCancel={() => setEditing(null)}
            onSaved={(message) => void done(message)}
            onError={fail}
          />
        </div>
      )}

      {zone.records.length === 0 && editing !== 'new' ? (
        <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <ListPlus className="h-6 w-6 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">Aucun enregistrement pour {zone.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Commencez par un enregistrement A qui fait pointer le domaine vers l&apos;un de vos serveurs.
            </p>
          </div>
          <Button variant="secondary" onClick={() => setEditing('new')} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Ajouter un enregistrement
          </Button>
        </div>
      ) : (
        <div className="scroll-thin overflow-x-auto overflow-y-hidden">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-2xs uppercase tracking-wider text-muted-foreground">
                <th className="w-24 px-4 py-2 font-medium lg:pl-5">Type</th>
                <th className="w-[30%] px-3 py-2 font-medium">Nom</th>
                <th className="px-3 py-2 font-medium">Contenu</th>
                <th className="w-20 px-3 py-2 font-medium">TTL</th>
                <th className="w-28 px-4 py-2 text-right font-medium lg:pr-5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((record) => {
                const isEditing = editing === record.id;
                const status = RECORD_STATUS[record.status] ?? RECORD_STATUS.pending;
                return (
                  <Fragment key={record.id}>
                    <tr
                      onClick={() => setEditing(isEditing ? null : record.id)}
                      className={cn(
                        'cursor-pointer border-b border-border align-top transition-colors last:border-0',
                        isEditing ? 'bg-primary/[0.04]' : 'hover:bg-surface-2/60',
                      )}
                    >
                      <td className="px-4 py-2.5 lg:pl-5">
                        <RecordTypeBadge type={record.type} />
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs">
                        <span className="flex items-start gap-2">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="mt-1.5">
                                <StatusDot tone={status.tone} pulse={record.status === 'pending'} />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>{status.label}</TooltipContent>
                          </Tooltip>
                          <RecordName name={record.name} zone={zone.name} />
                        </span>
                      </td>
                      <td className="max-w-0 px-3 py-2.5">
                        <div className="flex items-start gap-2">
                          <RecordContent record={record} nodes={nodes} />
                          {record.isGeo && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[hsl(var(--ok))]/25 bg-[hsl(var(--ok))]/10 px-1.5 py-0.5 text-2xs text-[hsl(var(--ok))]">
                                  <MapPin className="h-3 w-3" />
                                  Géo
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>Chaque visiteur reçoit la valeur la plus proche de lui.</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{formatTtl(record.ttl)}</td>
                      <td className="px-4 py-2 text-right lg:pr-5">
                        <span
                          className={cn(
                            'inline-flex items-center gap-0.5 text-xs font-medium',
                            isEditing ? 'text-foreground' : 'text-primary',
                          )}
                        >
                          {isEditing ? 'Fermer' : 'Modifier'}
                          <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', isEditing && 'rotate-90')} />
                        </span>
                      </td>
                    </tr>
                    {isEditing && (
                      <tr className="border-b border-border">
                        <td colSpan={5} className="px-4 py-3 lg:px-5">
                          <RecordEditor
                            zoneId={zone.id}
                            zoneName={zone.name}
                            record={record}
                            nodes={nodes}
                            onCancel={() => setEditing(null)}
                            onSaved={(message) => void done(message)}
                            onDeleted={(message) => void done(message)}
                            onError={fail}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    Aucun enregistrement ne correspond à ces filtres.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
