'use client';

import { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  Crown,
  History,
  LoaderCircle,
  MapPin,
  Play,
  RadioTower,
  RotateCcw,
  Route,
  Trash2,
  Waves,
  XCircle,
} from 'lucide-react';
import type { VlanConnectionTest, VlanMember } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusDot, StatusPill, type StatusTone } from '@/components/ui/status';
import { Tabs, TabsCount, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type LinkStatus = 'healthy' | 'degraded' | 'offline' | 'unknown';

export const REGION_LABELS: Record<string, string> = {
  europe: 'Europe',
  'north-america': 'Amérique du Nord',
  'south-america': 'Amérique du Sud',
  asia: 'Asie',
  oceania: 'Océanie',
  africa: 'Afrique',
};

export const regionLabel = (region: string | null | undefined) =>
  !region || region === 'unknown' ? 'Région inconnue' : (REGION_LABELS[region] ?? region);

export const LINK_STATUS: Record<LinkStatus, { tone: StatusTone; label: string }> = {
  healthy: { tone: 'ok', label: 'Sain' },
  degraded: { tone: 'warn', label: 'Dégradé' },
  offline: { tone: 'danger', label: 'Hors ligne' },
  unknown: { tone: 'neutral', label: 'Inconnu' },
};

const STATUS_RANK: Record<LinkStatus, number> = { offline: 0, degraded: 1, unknown: 2, healthy: 3 };

export const formatMs = (value?: number | null) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return value >= 100 ? `${Math.round(value)} ms` : `${value.toFixed(value >= 10 ? 1 : 2).replace('.', ',')} ms`;
};
export const formatPercent = (value?: number | null) =>
  typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 10) / 10} %`.replace('.', ',') : '—';

/** One undirected link between two nodes, both directions folded together. */
export type LinkSummary = {
  key: string;
  aId: string;
  bId: string;
  status: LinkStatus;
  latencyMs: number | null;
  packetLoss: number | null;
};

// --- Segmentation -------------------------------------------------------

export type RegionSummary = { region: string; members: VlanMember[]; gateway: VlanMember | null };

export function SegmentationCard({
  regions,
  linkBetween,
  name,
  saving,
  onToggleGateway,
  onOpenLocations,
}: {
  regions: RegionSummary[];
  linkBetween: (aId: string, bId: string) => LinkSummary | undefined;
  name: (nodeId: string) => string;
  saving: Record<string, boolean>;
  onToggleGateway: (nodeId: string, enabled: boolean) => void;
  onOpenLocations: () => void;
}) {
  const known = regions.filter((summary) => summary.region !== 'unknown');
  const unknown = regions.find((summary) => summary.region === 'unknown');
  const missingGateway = known.length > 1 ? known.filter((summary) => !summary.gateway) : [];
  const bridges: Array<[RegionSummary, RegionSummary]> = [];
  const withGateway = known.filter((summary) => summary.gateway);
  for (let i = 0; i < withGateway.length; i++) for (let j = i + 1; j < withGateway.length; j++) bridges.push([withGateway[i], withGateway[j]]);

  const state: { tone: StatusTone; label: string; text: string } =
    known.length <= 1
      ? {
          tone: 'neutral',
          label: 'Une seule région',
          text: 'Tous les nœuds sont dans la même région : ils sont reliés directement entre eux (maillage complet).',
        }
      : missingGateway.length === 0
        ? {
            tone: 'ok',
            label: 'Active',
            text: 'Dans chaque région, les nœuds sont reliés entre eux. Entre deux régions, le trafic passe uniquement par leurs passerelles.',
          }
        : {
            tone: 'warn',
            label: 'Incomplète',
            text: `Sans passerelle, ${missingGateway.map((summary) => regionLabel(summary.region)).join(', ')} reste relié${missingGateway.length > 1 ? 'es' : 'e'} directement à tous les nœuds des autres régions. Choisissez une passerelle pour terminer la segmentation.`,
          };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <RadioTower className="h-4 w-4 text-primary" />
          Segmentation régionale
          <StatusPill tone={state.tone} className="ml-1">
            {state.label}
          </StatusPill>
        </CardTitle>
        <CardDescription>{state.text}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {bridges.length > 0 && (
          <div className="space-y-2">
            {bridges.map(([a, b]) => {
              const link = a.gateway && b.gateway ? linkBetween(a.gateway.nodeId, b.gateway.nodeId) : undefined;
              const status = LINK_STATUS[link?.status ?? 'unknown'];
              return (
                <div
                  key={`${a.region}-${b.region}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-surface-2/50 px-3 py-2.5 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{regionLabel(a.region)}</span>
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 font-medium text-foreground">
                      <Crown className="h-3 w-3 text-primary" />
                      {name(a.gateway!.nodeId)}
                    </span>
                  </span>
                  <span className="flex flex-1 items-center gap-2 text-muted-foreground">
                    <span className="h-px min-w-[1.5rem] flex-1 bg-border" />
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-2xs">
                      <StatusDot tone={status.tone} pulse={link?.status === 'healthy'} />
                      {status.label}
                      {link?.latencyMs != null && ` · ${formatMs(link.latencyMs)}`}
                    </span>
                    <span className="h-px min-w-[1.5rem] flex-1 bg-border" />
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 font-medium text-foreground">
                      <Crown className="h-3 w-3 text-primary" />
                      {name(b.gateway!.nodeId)}
                    </span>
                    <span className="text-xs text-muted-foreground">{regionLabel(b.region)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {known.map((summary) => (
            <div key={summary.region} className="rounded-lg border border-border bg-surface-1">
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                <p className="text-sm font-medium text-foreground">{regionLabel(summary.region)}</p>
                <span className="text-2xs text-muted-foreground">
                  {summary.members.length} nœud{summary.members.length > 1 ? 's' : ''}
                </span>
              </div>
              <ul className="p-1.5">
                {summary.members.map((member) => {
                  const isGateway = Boolean(member.node?.overlayIsGateway);
                  const busy = saving[member.nodeId];
                  return (
                    <li key={member.nodeId} className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2">
                      <StatusDot tone={member.node?.status === 'online' ? 'ok' : member.node?.status === 'degraded' ? 'warn' : 'danger'} />
                      <span className={cn('min-w-0 flex-1 truncate text-sm', isGateway ? 'font-medium text-foreground' : 'text-foreground/85')} title={member.node?.name}>
                        {name(member.nodeId)}
                      </span>
                      {busy ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      ) : isGateway ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => onToggleGateway(member.nodeId, false)}
                              className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-2xs font-medium text-primary hover:bg-primary/20"
                            >
                              <Crown className="h-3 w-3" />
                              Passerelle
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>Cliquer pour retirer ce rôle</TooltipContent>
                        </Tooltip>
                      ) : (
                        known.length > 1 && (
                          <button
                            type="button"
                            onClick={() => onToggleGateway(member.nodeId, true)}
                            className="rounded-md px-1.5 py-0.5 text-2xs text-muted-foreground opacity-0 transition-opacity hover:bg-surface-3 hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                          >
                            {summary.gateway ? 'En faire la passerelle' : 'Choisir comme passerelle'}
                          </button>
                        )
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {unknown && (
            <div className="rounded-lg border border-dashed border-[hsl(var(--warn))]/40 bg-[hsl(var(--warn))]/[0.04] p-3">
              <p className="text-sm font-medium text-foreground">Région inconnue</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {unknown.members.map((member) => name(member.nodeId)).join(', ')} : pays introuvable, ces nœuds restent reliés à tout le monde.
              </p>
              <Button variant="secondary" size="sm" className="mt-2 gap-1.5" onClick={onOpenLocations}>
                <MapPin className="h-3.5 w-3.5" />
                Renseigner la localisation
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// --- Links --------------------------------------------------------------

export function sortLinks(links: LinkSummary[]) {
  return [...links].sort(
    (left, right) => STATUS_RANK[left.status] - STATUS_RANK[right.status] || (right.latencyMs ?? -1) - (left.latencyMs ?? -1),
  );
}

export function LinksPanel({
  links,
  name,
  selectedKey,
  onSelect,
  onShowHistory,
  onTest,
  className,
}: {
  links: LinkSummary[];
  name: (nodeId: string) => string;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onShowHistory: (key: string) => void;
  onTest: (aId: string, bId: string) => void;
  className?: string;
}) {
  const [filter, setFilter] = useState<'all' | 'issues'>('all');
  const sorted = useMemo(() => sortLinks(links), [links]);
  const issues = sorted.filter((link) => link.status === 'offline' || link.status === 'degraded');
  const shown = filter === 'issues' ? issues : sorted;

  return (
    <Card className={cn('flex flex-col overflow-hidden', className)}>
      <CardHeader>
        <CardTitle>
          <ArrowLeftRight className="h-4 w-4 text-primary" />
          Liens
        </CardTitle>
        <Tabs value={filter} onValueChange={(value) => setFilter(value as 'all' | 'issues')}>
          <TabsList variant="segmented">
            <TabsTrigger value="all">
              Tous <TabsCount>{links.length}</TabsCount>
            </TabsTrigger>
            <TabsTrigger value="issues">
              À surveiller <TabsCount>{issues.length}</TabsCount>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 ? (
          <p className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="h-5 w-5 text-[hsl(var(--ok))]" />
            {filter === 'issues' ? 'Tous les liens répondent normalement.' : 'Aucun lien mesuré pour l’instant.'}
          </p>
        ) : (
          <ul className="divide-y divide-border/70">
            {shown.map((link) => {
              const status = LINK_STATUS[link.status];
              const active = link.key === selectedKey;
              return (
                <li key={link.key} className={cn('group', active && 'bg-primary/[0.07]')}>
                  <div className="flex items-center gap-2.5 px-4 py-2.5">
                    <button type="button" onClick={() => onSelect(active ? null : link.key)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                      <StatusDot tone={status.tone} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-sm text-foreground">
                          <span className="truncate">{name(link.aId)}</span>
                          <ArrowLeftRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="truncate">{name(link.bId)}</span>
                        </span>
                        <span className="text-2xs text-muted-foreground">
                          {status.label}
                          {link.latencyMs != null && ` · ${formatMs(link.latencyMs)}`}
                          {link.packetLoss != null && link.packetLoss > 0 && ` · ${formatPercent(link.packetLoss)} perdus`}
                        </span>
                      </span>
                    </button>
                    <span className="flex shrink-0 items-center opacity-60 transition-opacity group-hover:opacity-100">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onShowHistory(link.key)} aria-label="Historique">
                            <History className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Voir l’historique</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onTest(link.aId, link.bId)} aria-label="Tester">
                            <Play className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Tester ce lien maintenant</TooltipContent>
                      </Tooltip>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}

// --- Locations ----------------------------------------------------------

export type LocationRow = {
  nodeId: string;
  name: string;
  vlanIp: string;
  city: string;
  country: string;
  countryCode: string;
  detected: { city: string; country: string; countryCode: string | null } | undefined;
  region: string | null;
  saving: boolean;
};

export function LocationEditor({
  rows,
  open,
  onOpenChange,
  onChange,
  onSave,
  onAuto,
  onResetGraph,
}: {
  rows: LocationRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (nodeId: string, patch: { city?: string; country?: string; countryCode?: string }) => void;
  onSave: (nodeId: string) => void;
  onAuto: (nodeId: string) => void;
  onResetGraph: () => void;
}) {
  const unknown = rows.filter((row) => !row.region).length;
  return (
    <Card id="network-locations" className="overflow-hidden">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2/50 lg:px-5"
        aria-expanded={open}
      >
        <MapPin className="h-4 w-4 text-primary" />
        <span className="flex-1">
          <span className="block text-sm font-semibold text-foreground">Localisation des nœuds</span>
          <span className="block text-xs text-muted-foreground">
            Détectée automatiquement depuis l’IP publique. Corrigez-la si un nœud est mal placé : elle détermine sa région.
          </span>
        </span>
        {unknown > 0 && <StatusPill tone="warn">{unknown} sans région</StatusPill>}
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t border-border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-2xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2 font-medium lg:px-5">Nœud</th>
                  <th className="px-2 py-2 font-medium">Ville</th>
                  <th className="px-2 py-2 font-medium">Pays</th>
                  <th className="w-20 px-2 py-2 font-medium">Code</th>
                  <th className="px-2 py-2 font-medium">Région</th>
                  <th className="w-24 px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.nodeId} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2 lg:px-5">
                      <p className="font-medium text-foreground">{row.name}</p>
                      <p className="font-mono text-2xs text-muted-foreground">{row.vlanIp}</p>
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        className="h-8"
                        value={row.city}
                        placeholder={row.detected?.city ?? 'Ville'}
                        onChange={(event) => onChange(row.nodeId, { city: event.target.value })}
                        onBlur={() => onSave(row.nodeId)}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        className="h-8"
                        value={row.country}
                        placeholder={row.detected?.country ?? 'Pays'}
                        onChange={(event) => onChange(row.nodeId, { country: event.target.value })}
                        onBlur={() => onSave(row.nodeId)}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        className="h-8 uppercase"
                        maxLength={2}
                        value={row.countryCode}
                        placeholder={row.detected?.countryCode ?? 'FR'}
                        onChange={(event) => onChange(row.nodeId, { countryCode: event.target.value })}
                        onBlur={() => onSave(row.nodeId)}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <StatusPill tone={row.region ? 'info' : 'warn'} dot={false}>
                        {regionLabel(row.region)}
                      </StatusPill>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" disabled={row.saving} onClick={() => onAuto(row.nodeId)} className="gap-1">
                            {row.saving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                            Auto
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Revenir à la détection automatique</TooltipContent>
                      </Tooltip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-2xs text-muted-foreground lg:px-5">
            Enregistré à la sortie du champ, partagé avec toute l’équipe.
            <Button variant="ghost" size="sm" onClick={onResetGraph} className="h-7 text-2xs">
              Réinitialiser la disposition du graphe
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// --- Matrix -------------------------------------------------------------

const MATRIX_CELL: Record<LinkStatus, string> = {
  healthy: 'bg-[hsl(var(--ok))]/70 hover:bg-[hsl(var(--ok))]',
  degraded: 'bg-[hsl(var(--warn))]/70 hover:bg-[hsl(var(--warn))]',
  offline: 'bg-[hsl(var(--danger))]/70 hover:bg-[hsl(var(--danger))]',
  unknown: 'bg-surface-3 hover:bg-muted-foreground/40',
};

export function ConnectionMatrix({
  nodeIds,
  name,
  cell,
  selectedKey,
  onSelect,
}: {
  nodeIds: string[];
  name: (nodeId: string) => string;
  cell: (fromId: string, toId: string) => { relayed: boolean; status?: LinkStatus; latencyMs?: number | null; packetLoss?: number | null };
  selectedKey: string | null;
  onSelect: (pairKey: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-1 text-2xs">
        <thead>
          <tr>
            <th className="sticky left-0 bg-surface-1 px-2 text-left font-normal text-muted-foreground">De ↓ · Vers →</th>
            {nodeIds.map((id) => (
              <th key={id} className="h-24 w-8 align-bottom font-normal">
                <span className="inline-block max-w-[6rem] origin-bottom-left translate-x-3 -rotate-45 truncate whitespace-nowrap text-left text-muted-foreground" title={name(id)}>
                  {name(id)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {nodeIds.map((from) => (
            <tr key={from}>
              <th className="sticky left-0 max-w-[10rem] truncate bg-surface-1 px-2 text-left font-normal text-foreground/85" title={name(from)}>
                {name(from)}
              </th>
              {nodeIds.map((to) => {
                if (from === to) return <td key={to} className="h-7 w-8 rounded bg-surface-2/40" />;
                const value = cell(from, to);
                const pairKey = [from, to].sort().join('__');
                const label = value.relayed
                  ? `${name(from)} → ${name(to)} : relayé par les passerelles (pas de lien direct)`
                  : `${name(from)} → ${name(to)} : ${LINK_STATUS[value.status ?? 'unknown'].label} · ${formatMs(value.latencyMs)} · perte ${formatPercent(value.packetLoss)}`;
                return (
                  <td key={to} className="h-7 w-8 p-0">
                    {value.relayed ? (
                      <span
                        title={label}
                        className="block h-7 w-8 rounded bg-[repeating-linear-gradient(135deg,hsl(var(--surface-3))_0_3px,transparent_3px_6px)] opacity-70"
                      />
                    ) : (
                      <button
                        type="button"
                        title={label}
                        aria-label={label}
                        onClick={() => onSelect(pairKey)}
                        className={cn(
                          'block h-7 w-8 rounded transition-colors',
                          MATRIX_CELL[value.status ?? 'unknown'],
                          selectedKey === pairKey && 'ring-2 ring-primary ring-offset-1 ring-offset-surface-1',
                        )}
                      />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-muted-foreground">
        {(['healthy', 'degraded', 'offline', 'unknown'] as const).map((status) => (
          <span key={status} className="flex items-center gap-1.5">
            <span className={cn('h-2.5 w-2.5 rounded-sm', MATRIX_CELL[status])} />
            {LINK_STATUS[status].label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-[repeating-linear-gradient(135deg,hsl(var(--surface-3))_0_2px,transparent_2px_4px)]" />
          Relayé par les passerelles
        </span>
      </div>
    </div>
  );
}

// --- Diagnostics --------------------------------------------------------

type TestType = 'ping' | 'traceroute';

export function DiagnosticsPanel({
  members,
  name,
  tests,
  running,
  draft,
  onDraftChange,
  onRun,
  onRerun,
  onClear,
  hopLabel,
}: {
  members: VlanMember[];
  name: (nodeId: string) => string;
  tests: VlanConnectionTest[];
  running: boolean;
  draft: { from?: string; to?: string; type: TestType };
  onDraftChange: (draft: { from?: string; to?: string; type: TestType }) => void;
  onRun: () => void;
  onRerun: (test: VlanConnectionTest) => void;
  onClear: () => void;
  hopLabel: (ip: string | null) => { name: string; region: string | null; gateway: boolean } | null;
}) {
  const sorted = useMemo(() => [...members].sort((a, b) => name(a.nodeId).localeCompare(name(b.nodeId))), [members, name]);
  const ready = Boolean(draft.from && draft.to && draft.from !== draft.to);
  const option = (member: VlanMember) => (
    <SelectItem key={member.nodeId} value={member.nodeId} disabled={member.node?.status === 'offline' && false}>
      <span className="flex items-center gap-2">
        <StatusDot tone={member.node?.status === 'online' ? 'ok' : member.node?.status === 'degraded' ? 'warn' : 'danger'} />
        {name(member.nodeId)}
        <span className="font-mono text-2xs text-muted-foreground">{member.vlanIp}</span>
      </span>
    </SelectItem>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <Waves className="h-4 w-4 text-primary" />
            Tester la connectivité
          </CardTitle>
          <CardDescription>
            Le test part de l’agent du nœud source, à travers le réseau privé. Le ping mesure la latence et la perte sur 5 paquets ; le traceroute
            montre par où passe le trafic (passerelles comprises).
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[12rem] flex-1 space-y-1">
              <label className="text-2xs text-muted-foreground">Depuis</label>
              <Select value={draft.from} onValueChange={(value) => onDraftChange({ ...draft, from: value, to: draft.to === value ? undefined : draft.to })}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Nœud source" />
                </SelectTrigger>
                <SelectContent>{sorted.map(option)}</SelectContent>
              </Select>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="mb-0.5 h-8 w-8"
              aria-label="Inverser"
              title="Inverser source et cible"
              disabled={!draft.from && !draft.to}
              onClick={() => onDraftChange({ ...draft, from: draft.to, to: draft.from })}
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
            </Button>
            <div className="min-w-[12rem] flex-1 space-y-1">
              <label className="text-2xs text-muted-foreground">Vers</label>
              <Select value={draft.to} onValueChange={(value) => onDraftChange({ ...draft, to: value })}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Nœud cible" />
                </SelectTrigger>
                <SelectContent>{sorted.filter((member) => member.nodeId !== draft.from).map(option)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-2xs text-muted-foreground">Test</label>
              <Tabs value={draft.type} onValueChange={(value) => onDraftChange({ ...draft, type: value as TestType })}>
                <TabsList variant="segmented" className="h-9">
                  <TabsTrigger value="ping" className="gap-1.5">
                    <Waves className="h-3.5 w-3.5" />
                    Ping
                  </TabsTrigger>
                  <TabsTrigger value="traceroute" className="gap-1.5">
                    <Route className="h-3.5 w-3.5" />
                    Traceroute
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <Button onClick={onRun} disabled={!ready || running} className="h-9 gap-1.5 px-4">
              {running ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {running ? 'Test en cours…' : 'Lancer'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {tests.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 px-1">
            <p className="text-2xs text-muted-foreground">
              Résultats de cette session — ils ne sont pas enregistrés et disparaissent quand vous quittez la page.
            </p>
            <Button variant="ghost" size="sm" onClick={onClear} className="h-7 gap-1 text-2xs">
              <Trash2 className="h-3 w-3" />
              Effacer
            </Button>
          </div>
          {tests.map((test) => (
            <TestResult key={test.id} test={test} name={name} hopLabel={hopLabel} onRerun={() => onRerun(test)} running={running} />
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'warn' }) {
  return (
    <div className="rounded-lg bg-surface-2/60 px-3 py-2">
      <p className="text-2xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          'text-base font-semibold tabular-nums text-foreground',
          tone === 'danger' && 'text-[hsl(var(--danger))]',
          tone === 'warn' && 'text-[hsl(var(--warn))]',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function TestResult({
  test,
  name,
  hopLabel,
  onRerun,
  running,
}: {
  test: VlanConnectionTest;
  name: (nodeId: string) => string;
  hopLabel: (ip: string | null) => { name: string; region: string | null; gateway: boolean } | null;
  onRerun: () => void;
  running: boolean;
}) {
  const ok = test.status === 'success';
  const loss = test.packetLoss ?? null;
  const from = test.initiatorNode?.name ? name(test.initiatorNodeId) : test.initiatorNodeId.slice(0, 8);
  const to = test.targetNode?.name ? name(test.targetNodeId) : test.targetNodeId.slice(0, 8);
  return (
    <Card className="overflow-hidden animate-fade-in">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <span
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
            ok ? 'bg-[hsl(var(--ok))]/10 text-[hsl(var(--ok))]' : 'bg-[hsl(var(--danger))]/10 text-[hsl(var(--danger))]',
          )}
        >
          {ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground">
            {test.testType === 'ping' ? 'Ping' : 'Traceroute'}
            <span className="font-normal text-muted-foreground">de</span> {from}
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            {to}
          </p>
          <p className={cn('text-xs', ok ? 'text-muted-foreground' : 'text-[hsl(var(--danger))]')}>
            {test.resultMessage}
            <span className="text-muted-foreground">
              {' · '}
              {new Date(test.startedAt).toLocaleTimeString('fr-FR')}
              {test.durationMs != null && ` · ${(test.durationMs / 1000).toFixed(1).replace('.', ',')} s`}
            </span>
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onRerun} disabled={running} className="gap-1.5">
          <RotateCcw className="h-3.5 w-3.5" />
          Relancer
        </Button>
      </div>

      {test.testType === 'ping' && ok && (
        <div className="grid grid-cols-2 gap-2 border-t border-border px-4 py-3 sm:grid-cols-4">
          <Metric label="Latence moyenne" value={formatMs(test.latencyMs)} />
          <Metric label="Minimum" value={formatMs(test.minMs)} />
          <Metric label="Maximum" value={formatMs(test.maxMs)} />
          <Metric label="Paquets perdus" value={formatPercent(loss)} tone={loss != null && loss >= 20 ? 'danger' : loss != null && loss > 0 ? 'warn' : undefined} />
        </div>
      )}

      {test.testType === 'traceroute' && (test.hops?.length ?? 0) > 0 && (
        <ol className="border-t border-border px-4 py-3">
          <li className="flex items-center gap-3 pb-2 text-xs text-muted-foreground">
            <span className="flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface-2 text-[9px]">●</span>
            <span className="font-medium text-foreground">{from}</span>
            <span className="font-mono text-2xs">{test.initiatorNode?.vlanIp}</span>
          </li>
          {test.hops!.map((hop, index) => {
            const known = hopLabel(hop.ip);
            const last = index === test.hops!.length - 1;
            return (
              <li key={hop.hop} className="relative flex items-center gap-3 py-1.5 pl-0 text-xs">
                <span className="absolute left-[9px] top-[-6px] h-[calc(50%+2px)] w-px bg-border" aria-hidden />
                <span
                  className={cn(
                    'relative z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[9px] tabular-nums',
                    hop.ip ? (last && ok ? 'border-[hsl(var(--ok))]/50 bg-[hsl(var(--ok))]/15 text-[hsl(var(--ok))]' : 'border-border bg-surface-2 text-muted-foreground') : 'border-dashed border-border text-muted-foreground',
                  )}
                >
                  {hop.hop}
                </span>
                {hop.ip ? (
                  <>
                    <span className={cn('font-medium', known ? 'text-foreground' : 'text-foreground/80')}>{known?.name ?? 'Routeur intermédiaire'}</span>
                    <span className="font-mono text-2xs text-muted-foreground">{hop.ip}</span>
                    {known?.gateway && (
                      <StatusPill tone="accent" dot={false}>
                        <Crown className="mr-1 h-3 w-3" />
                        Passerelle
                      </StatusPill>
                    )}
                    {known?.region && <span className="text-2xs text-muted-foreground">{regionLabel(known.region)}</span>}
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <CircleSlash className="h-3 w-3" />
                    pas de réponse à ce saut
                  </span>
                )}
                <span className="ml-auto font-mono text-2xs tabular-nums text-muted-foreground">{formatMs(hop.latencyMs)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
