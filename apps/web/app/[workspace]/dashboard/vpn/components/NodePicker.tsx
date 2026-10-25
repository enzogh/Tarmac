'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import type { VpnGateway } from '@/lib/api';
import { StatusDot, type StatusTone } from '@/components/ui/status';
import { cn } from '@/lib/utils';
import { NodeFlag } from './vpn-ui';

const STATUS: Record<VpnGateway['status'], { tone: StatusTone; label: string }> = {
  online: { tone: 'ok', label: 'En ligne' },
  degraded: { tone: 'warn', label: 'Dégradé' },
  offline: { tone: 'danger', label: 'Hors ligne' },
};

const UNKNOWN_COUNTRY = 'Localisation inconnue';

export type NodePickerPinned = { gateway: VpnGateway; badge: string };

type Row = { gateway: VpnGateway; badge?: string; disabledReason: string | null };

const countryOf = (gateway: VpnGateway) => gateway.locationCountry?.trim() || UNKNOWN_COUNTRY;

function matches(gateway: VpnGateway, needle: string) {
  if (!needle) return true;
  return [gateway.name, gateway.publicIp, gateway.locationCity, gateway.locationCountry, gateway.vlanIp]
    .filter(Boolean)
    .some((value) => (value as string).toLowerCase().includes(needle));
}

/**
 * Picks one node out of a fleet that can be large: search by name, IP or
 * city, narrow to a country, and the list stays grouped by country with the
 * reason a node can't be used shown in place. The rows are a radio group
 * driven from the search field with ↑/↓/Entrée, so it works without leaving
 * the keyboard.
 */
export function NodePicker({
  gateways,
  value,
  onSelect,
  disabledReason,
  meta,
  pinned = [],
  autoFocus,
  busyId,
  className,
  listClassName = 'max-h-[19rem]',
}: {
  gateways: VpnGateway[];
  value: string | null;
  onSelect: (gateway: VpnGateway) => void;
  /** Why a node can't be picked (shown under its name), or null. */
  disabledReason?: (gateway: VpnGateway) => string | null;
  /** Short right-aligned detail per row, e.g. how many profiles use it. */
  meta?: (gateway: VpnGateway) => string | null;
  /** Shown first, above the country groups, with a badge (e.g. direct exit). */
  pinned?: NodePickerPinned[];
  autoFocus?: boolean;
  /** Row showing a spinner-like pending state while its selection applies. */
  busyId?: string | null;
  className?: string;
  listClassName?: string;
}) {
  const [query, setQuery] = useState('');
  const [country, setCountry] = useState<string | null>(null);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Filters keep the keyboard in the search field, so ↑/↓/Entrée still work.
  const refocus = () => inputRef.current?.focus({ preventScroll: true });

  const pinnedIds = useMemo(() => new Set(pinned.map((item) => item.gateway.id)), [pinned]);
  const reason = (gateway: VpnGateway) => disabledReason?.(gateway) ?? null;

  const countries = useMemo(() => {
    const counts = new Map<string, { count: number; code: string | null | undefined }>();
    for (const gateway of gateways) {
      const key = countryOf(gateway);
      const current = counts.get(key);
      counts.set(key, { count: (current?.count ?? 0) + 1, code: current?.code ?? gateway.locationCountryCode });
    }
    return [...counts.entries()]
      .map(([name, { count, code }]) => ({ name, count, code }))
      .sort((left, right) => {
        if ((left.name === UNKNOWN_COUNTRY) !== (right.name === UNKNOWN_COUNTRY)) return left.name === UNKNOWN_COUNTRY ? 1 : -1;
        return right.count - left.count || left.name.localeCompare(right.name);
      });
  }, [gateways]);

  const needle = query.trim().toLowerCase();
  const keep = (gateway: VpnGateway) =>
    matches(gateway, needle) && (!country || countryOf(gateway) === country) && (!onlineOnly || gateway.status !== 'offline');

  const { pinnedRows, groups, flat } = useMemo(() => {
    const pinnedRows: Row[] = pinned
      .filter((item) => keep(item.gateway))
      .map((item) => ({ gateway: item.gateway, badge: item.badge, disabledReason: reason(item.gateway) }));
    const byCountry = new Map<string, Row[]>();
    for (const gateway of gateways) {
      if (pinnedIds.has(gateway.id) || !keep(gateway)) continue;
      const rows = byCountry.get(countryOf(gateway)) ?? [];
      rows.push({ gateway, disabledReason: reason(gateway) });
      byCountry.set(countryOf(gateway), rows);
    }
    // Usable first, then by name: unusable nodes stay listed (with their
    // reason) so nobody wonders where a server went.
    const groups = countries
      .filter((item) => byCountry.has(item.name))
      .map((item) => ({
        ...item,
        rows: byCountry.get(item.name)!.sort((left, right) => {
          if ((left.disabledReason === null) !== (right.disabledReason === null)) return left.disabledReason === null ? -1 : 1;
          if ((left.gateway.status === 'offline') !== (right.gateway.status === 'offline')) return left.gateway.status === 'offline' ? 1 : -1;
          return left.gateway.name.localeCompare(right.gateway.name);
        }),
      }));
    return { pinnedRows, groups, flat: [...pinnedRows, ...groups.flatMap((group) => group.rows)] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateways, pinned, pinnedIds, countries, needle, country, onlineOnly, disabledReason]);

  useEffect(() => setActive(0), [needle, country, onlineOnly]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (row: Row | undefined) => {
    if (!row || row.disabledReason) return;
    onSelect(row.gateway);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, flat.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(flat[active]);
    }
  };

  const showGroups = countries.length > 1 && !country;
  const offlineCount = gateways.filter((gateway) => gateway.status === 'offline').length;
  let index = -1;

  const renderRow = (row: Row) => {
    index += 1;
    const rowIndex = index;
    const { gateway } = row;
    const selected = gateway.id === value;
    const status = STATUS[gateway.status];
    const detail = meta?.(gateway);
    return (
      <button
        key={gateway.id}
        type="button"
        role="radio"
        aria-checked={selected}
        aria-disabled={Boolean(row.disabledReason)}
        data-index={rowIndex}
        onClick={() => choose(row)}
        onMouseMove={() => setActive(rowIndex)}
        className={cn(
          'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors',
          rowIndex === active && !row.disabledReason && 'bg-surface-3/60',
          selected && 'bg-primary/[0.08] ring-1 ring-inset ring-primary/40',
          row.disabledReason ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        )}
      >
        <span
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
            selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
          )}
          aria-hidden
        >
          {selected && <Check className="h-3 w-3" strokeWidth={3} />}
        </span>
        <NodeFlag node={gateway} className="shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{gateway.name}</span>
            {row.badge && (
              <span className="shrink-0 rounded border border-primary/30 bg-primary/10 px-1.5 text-2xs font-medium text-primary">
                {row.badge}
              </span>
            )}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
            <span className="truncate font-mono">{gateway.publicIp ?? 'IP publique inconnue'}</span>
            {gateway.locationCity && (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{gateway.locationCity}</span>
              </>
            )}
          </span>
          {row.disabledReason && <span className="block text-2xs text-[hsl(var(--warn))]">{row.disabledReason}</span>}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          <span className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground">
            <StatusDot tone={status.tone} pulse={busyId === gateway.id} />
            {busyId === gateway.id ? 'Application…' : status.label}
          </span>
          {detail && <span className="text-2xs text-muted-foreground">{detail}</span>}
        </span>
      </button>
    );
  };

  return (
    <div className={cn('overflow-hidden rounded-lg border border-border bg-surface-1', className)}>
      <div className="space-y-2 border-b border-border p-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              autoFocus={autoFocus}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={`Rechercher parmi ${gateways.length} serveur${gateways.length > 1 ? 's' : ''} (nom, IP, ville…)`}
              aria-label="Rechercher un serveur"
              className="h-8 w-full rounded-md border border-border bg-zinc-950/70 pl-8 pr-7 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  refocus();
                }}
                aria-label="Effacer la recherche"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {offlineCount > 0 && (
            <label className="flex shrink-0 cursor-pointer select-none items-center gap-1.5 text-2xs text-muted-foreground">
              <input
                type="checkbox"
                checked={onlineOnly}
                onChange={(event) => {
                  setOnlineOnly(event.target.checked);
                  refocus();
                }}
                className="h-3.5 w-3.5 rounded"
              />
              Masquer hors ligne
            </label>
          )}
        </div>
        {countries.length > 1 && (
          <div className="scroll-thin -mx-2 flex gap-1.5 overflow-x-auto px-2 pb-0.5">
            <CountryChip
              active={!country}
              onClick={() => {
                setCountry(null);
                refocus();
              }}
            >
              Tous <span className="text-muted-foreground">{gateways.length}</span>
            </CountryChip>
            {countries.map((item) => (
              <CountryChip
                key={item.name}
                active={country === item.name}
                onClick={() => {
                  setCountry(country === item.name ? null : item.name);
                  refocus();
                }}
              >
                {item.name !== UNKNOWN_COUNTRY && <NodeFlag node={{ locationCountryCode: item.code }} className="text-sm" />}
                {item.name === UNKNOWN_COUNTRY ? 'Inconnu' : item.name}
                <span className="text-muted-foreground">{item.count}</span>
              </CountryChip>
            ))}
          </div>
        )}
      </div>

      <div ref={listRef} role="radiogroup" className={cn('scroll-thin overflow-y-auto overscroll-y-contain p-1', listClassName)}>
        {flat.length === 0 && (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">Aucun serveur ne correspond à cette recherche.</p>
        )}
        {pinnedRows.length > 0 && (
          <div className="pb-1">
            {(showGroups || groups.length > 0) && <GroupHeader>Recommandé</GroupHeader>}
            {pinnedRows.map(renderRow)}
          </div>
        )}
        {groups.map((group) => (
          <div key={group.name} className="pb-1">
            {(showGroups || pinnedRows.length > 0) && (
              <GroupHeader>
                {group.name !== UNKNOWN_COUNTRY && <NodeFlag node={{ locationCountryCode: group.code }} className="text-sm" />}
                {group.name}
                <span className="font-normal normal-case tracking-normal text-muted-foreground/70">{group.rows.length}</span>
              </GroupHeader>
            )}
            {group.rows.map(renderRow)}
          </div>
        ))}
      </div>
    </div>
  );
}

function GroupHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-1.5 bg-surface-1 px-2.5 pb-1 pt-2 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

function CountryChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-2xs transition-colors',
        active ? 'border-primary/50 bg-primary/10 font-medium text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
