'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Eye,
  History,
  Info,
  Search,
  Server,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { AlertItem, api } from '../../../../lib/api';
import { usePolling } from '../../../../lib/hooks/usePolling';
import { ALERT_STATUS, SEVERITY, StatusPill, describe } from '../../../../components/ui/status';
import { PageHeader } from '../../../../components/PageHeader';
import { Callout } from '../../../../components/Callout';
import { Stat, StatRow } from '../../../../components/ui/stat';
import { Card } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../components/ui/select';
import { Tabs, TabsCount, TabsList, TabsTrigger } from '../../../../components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../components/ui/tooltip';
import { ListSkeleton, StatCardSkeleton } from '../../../../components/ui/skeleton';
import { formatDateTime, formatRelative, shortHostname } from '../../../../lib/format';
import { cn } from '../../../../lib/utils';

type SeverityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low';
type StatusTab = 'todo' | 'resolved' | 'all';

const ANY_NODE = '__any__';
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const RESOLVED_WINDOW_MS = 7 * 24 * 3600 * 1000;

// Left accent of a row: the one thing an operator scans the list by.
const SEVERITY_BAR: Record<string, string> = {
  critical: 'bg-[hsl(var(--danger))]',
  high: 'bg-[hsl(var(--danger))]/70',
  medium: 'bg-[hsl(var(--warn))]',
  low: 'bg-[hsl(var(--info))]',
};
const SEVERITY_ICON: Record<string, typeof AlertCircle> = { critical: AlertCircle, high: AlertCircle, medium: AlertTriangle, low: Info };

/**
 * One row per recurring alert, not per occurrence.
 *
 * A rule that keeps firing writes a new row every time it does, so a fleet
 * with one flapping VLAN link produced dozens of byte-identical "Lien VLAN
 * hors ligne : A <-> B" alerts. Collapsing on the message gives one line per
 * distinct problem, carrying how many times it fired and when it first and
 * last did; the occurrences are still there, one click away.
 */
type AlertGroup = {
  key: string;
  message: string;
  title: string;
  detail: string | null;
  severity: string;
  /** Worst status across the group: an unread occurrence outranks a read one. */
  status: string;
  firstTriggeredAt: string;
  lastTriggeredAt: string;
  node: { id: string; name: string } | null;
  rule: AlertItem['rule'];
  occurrences: AlertItem[];
};

// "Lien VLAN hors ligne : A ↔ B" reads better as a short title over its
// specifics than as one long truncated line.
function splitMessage(message: string): { title: string; detail: string | null } {
  const index = message.indexOf(' : ');
  if (index > 0 && index <= 48) return { title: message.slice(0, index), detail: message.slice(index + 3) };
  return { title: message, detail: null };
}

function groupAlerts(alerts: AlertItem[]): AlertGroup[] {
  const byMessage = new Map<string, AlertItem[]>();
  for (const alert of alerts) {
    const list = byMessage.get(alert.message) ?? [];
    list.push(alert);
    byMessage.set(alert.message, list);
  }

  return [...byMessage.entries()]
    .map(([message, occurrences]) => {
      const sorted = [...occurrences].sort((left, right) => new Date(right.triggeredAt).getTime() - new Date(left.triggeredAt).getTime());
      const status = sorted.some((alert) => alert.status === 'open')
        ? 'open'
        : sorted.some((alert) => alert.status === 'acknowledged')
          ? 'acknowledged'
          : 'resolved';
      const severity = sorted.reduce(
        (worst, alert) => ((SEVERITY_RANK[alert.severity] ?? 9) < (SEVERITY_RANK[worst] ?? 9) ? alert.severity : worst),
        sorted[0].severity,
      );
      const withNode = sorted.find((alert) => alert.node);
      return {
        key: message,
        message,
        ...splitMessage(message),
        severity,
        status,
        firstTriggeredAt: sorted[sorted.length - 1].triggeredAt,
        lastTriggeredAt: sorted[0].triggeredAt,
        node: withNode?.node ?? null,
        rule: sorted.find((alert) => alert.rule)?.rule ?? null,
        occurrences: sorted,
      };
    })
    .sort((left, right) => {
      // Unresolved first, then by severity, then most recent - the order an
      // operator triages in.
      const unresolved = Number(right.status !== 'resolved') - Number(left.status !== 'resolved');
      if (unresolved !== 0) return unresolved;
      const bySeverity = (SEVERITY_RANK[left.severity] ?? 9) - (SEVERITY_RANK[right.severity] ?? 9);
      if (bySeverity !== 0) return bySeverity;
      return new Date(right.lastTriggeredAt).getTime() - new Date(left.lastTriggeredAt).getTime();
    });
}

function AlertRow({
  group,
  selected,
  expanded,
  busy,
  workspace,
  onToggleSelect,
  onToggleExpand,
  onAck,
  onResolve,
  onDelete,
}: {
  group: AlertGroup;
  selected: boolean;
  expanded: boolean;
  busy: boolean;
  workspace: string;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onAck: () => void;
  onResolve: () => void;
  onDelete: () => void;
}) {
  const severity = describe(SEVERITY, group.severity);
  const status = describe(ALERT_STATUS, group.status);
  const Icon = group.status === 'resolved' ? CheckCircle2 : (SEVERITY_ICON[group.severity] ?? AlertTriangle);
  const resolved = group.status === 'resolved';
  const count = group.occurrences.length;

  return (
    <li className={cn('relative transition-colors', selected ? 'bg-primary/[0.06]' : 'hover:bg-surface-2/50')}>
      <span className={cn('absolute inset-y-0 left-0 w-[3px]', resolved ? 'bg-[hsl(var(--ok))]/50' : SEVERITY_BAR[group.severity])} aria-hidden />
      <div className="flex flex-wrap items-start gap-3 py-3 pl-4 pr-4 sm:flex-nowrap lg:pl-5 lg:pr-5">
        <input
          type="checkbox"
          aria-label={`Sélectionner « ${group.message} »`}
          checked={selected}
          onChange={onToggleSelect}
          className="mt-1 h-3.5 w-3.5 shrink-0 rounded border-border"
        />
        <span
          className={cn(
            'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
            resolved
              ? 'bg-[hsl(var(--ok))]/10 text-[hsl(var(--ok))]'
              : group.severity === 'medium'
                ? 'bg-[hsl(var(--warn))]/10 text-[hsl(var(--warn))]'
                : group.severity === 'low'
                  ? 'bg-[hsl(var(--info))]/10 text-[hsl(var(--info))]'
                  : 'bg-[hsl(var(--danger))]/10 text-[hsl(var(--danger))]',
          )}
        >
          <Icon className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className={cn('text-sm font-medium', resolved ? 'text-muted-foreground' : 'text-foreground')}>{group.title}</p>
            <StatusPill tone={severity.tone} dot={false}>
              {severity.label}
            </StatusPill>
            {group.status !== 'open' && <StatusPill tone={status.tone}>{status.label}</StatusPill>}
          </div>
          {group.detail && <p className="mt-0.5 break-words text-xs text-muted-foreground">{group.detail}</p>}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
            {group.node && (
              <Link
                href={`/${workspace}/dashboard/infrastructure`}
                className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 hover:border-foreground/20 hover:text-foreground"
                title={group.node.name}
              >
                <Server className="h-3 w-3" />
                {shortHostname(group.node.name)}
              </Link>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex cursor-default items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {count > 1 ? `dernière ${formatRelative(group.lastTriggeredAt)}` : formatRelative(group.lastTriggeredAt)}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {count > 1 ? `Première : ${formatDateTime(group.firstTriggeredAt)} · dernière : ${formatDateTime(group.lastTriggeredAt)}` : formatDateTime(group.lastTriggeredAt)}
              </TooltipContent>
            </Tooltip>
            {group.rule && <span>Règle « {group.rule.name} »</span>}
            <button type="button" onClick={onToggleExpand} className="inline-flex items-center gap-1 hover:text-foreground" aria-expanded={expanded}>
              <History className="h-3 w-3" />
              {count > 1 ? `${count} déclenchements` : 'Historique'}
              <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
            </button>
          </div>
        </div>

        <div className="flex basis-full items-center justify-end gap-1.5 sm:basis-auto sm:shrink-0 sm:self-center">
          {group.status === 'open' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="secondary" size="sm" disabled={busy} onClick={onAck} className="hidden gap-1.5 sm:inline-flex">
                  <Eye className="h-3.5 w-3.5" />
                  Prendre en compte
                </Button>
              </TooltipTrigger>
              <TooltipContent>Signale à l’équipe que quelqu’un s’en occupe, sans fermer l’alerte.</TooltipContent>
            </Tooltip>
          )}
          {!resolved && (
            <Button variant="secondary" size="sm" disabled={busy} onClick={onResolve} className="gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--ok))]" />
              Résoudre
            </Button>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" disabled={busy} onClick={onDelete} aria-label="Supprimer" className="hover:text-[hsl(var(--danger))]">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Supprimer définitivement {count > 1 ? `les ${count} déclenchements` : ''}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {expanded && (
        <ol className="mb-3 ml-[4.75rem] mr-4 space-y-0 border-l border-border pl-4 lg:ml-[5.25rem]">
          {group.occurrences.map((alert) => {
            const occurrenceStatus = describe(ALERT_STATUS, alert.status);
            return (
              <li key={alert.id} className="relative flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-2xs text-muted-foreground">
                <span className="absolute -left-[1.3rem] top-1/2 h-2 w-2 -translate-y-1/2 rounded-full border border-border bg-surface-1" aria-hidden />
                <span className="tabular-nums text-foreground/90">{formatDateTime(alert.triggeredAt)}</span>
                <StatusPill tone={occurrenceStatus.tone} dot={false}>
                  {occurrenceStatus.label}
                </StatusPill>
                {alert.acknowledgedAt && <span>prise en compte {formatDateTime(alert.acknowledgedAt)}</span>}
                {alert.resolvedAt && <span>résolue {formatDateTime(alert.resolvedAt)}</span>}
              </li>
            );
          })}
        </ol>
      )}
    </li>
  );
}

export default function AlertsPage() {
  const params = useParams<{ workspace: string }>();
  const { data: alerts = [], mutate, isLoading } = usePolling('alerts', api.alerts.list, { intervalMs: 20000 });

  const [statusTab, setStatusTab] = useState<StatusTab>('todo');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [nodeFilter, setNodeFilter] = useState(ANY_NODE);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(() => groupAlerts(alerts), [alerts]);
  const open = useMemo(() => groups.filter((group) => group.status !== 'resolved'), [groups]);
  // Counted per distinct problem, like the list below - not per occurrence.
  const counts = useMemo(() => {
    const now = Date.now();
    return {
      critical: open.filter((group) => group.severity === 'critical').length,
      high: open.filter((group) => group.severity === 'high').length,
      minor: open.filter((group) => group.severity === 'medium' || group.severity === 'low').length,
      resolvedWeek: groups.filter((group) => group.status === 'resolved' && now - new Date(group.lastTriggeredAt).getTime() < RESOLVED_WINDOW_MS).length,
    };
  }, [groups, open]);

  const nodeOptions = useMemo(() => {
    const byId = new Map<string, string>();
    groups.forEach((group) => group.node && byId.set(group.node.id, group.node.name));
    return [...byId.entries()].sort(([, a], [, b]) => a.localeCompare(b));
  }, [groups]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return groups.filter((group) => {
      if (statusTab === 'todo' && group.status === 'resolved') return false;
      if (statusTab === 'resolved' && group.status !== 'resolved') return false;
      if (severityFilter !== 'all' && group.severity !== severityFilter) return false;
      if (nodeFilter !== ANY_NODE && group.node?.id !== nodeFilter) return false;
      if (needle && !`${group.message} ${group.node?.name ?? ''}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [groups, statusTab, severityFilter, nodeFilter, query]);

  const filtersActive = severityFilter !== 'all' || nodeFilter !== ANY_NODE || query.trim() !== '';
  const allVisibleSelected = visible.length > 0 && visible.every((group) => selected.has(group.key));
  const selectedGroups = useMemo(() => visible.filter((group) => selected.has(group.key)), [visible, selected]);
  const selectedIds = useMemo(() => selectedGroups.flatMap((group) => group.occurrences.map((alert) => alert.id)), [selectedGroups]);

  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  const run = async (action: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await mutate();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : failure);
    } finally {
      setBusy(false);
    }
  };

  // Acting on a group acts on every occurrence behind it: "this problem is
  // handled" is the statement being made, not "this one copy of it is".
  const ackGroups = (targets: AlertGroup[]) =>
    run(
      () => Promise.all(targets.flatMap((group) => group.occurrences.filter((a) => a.status === 'open').map((a) => api.alerts.ack(a.id)))),
      'Échec de la prise en compte.',
    );
  const resolveGroups = (targets: AlertGroup[]) =>
    run(
      () => Promise.all(targets.flatMap((group) => group.occurrences.filter((a) => a.status !== 'resolved').map((a) => api.alerts.resolve(a.id)))),
      'Échec de la résolution.',
    );
  const deleteGroups = async (targets: AlertGroup[]) => {
    const ids = targets.flatMap((group) => group.occurrences.map((a) => a.id));
    if (ids.length === 0) return;
    const label = targets.length === 1 ? `« ${targets[0].title} »` : `${targets.length} alertes`;
    if (!window.confirm(`Supprimer définitivement ${label} (${ids.length} déclenchement${ids.length > 1 ? 's' : ''}) ? L’historique sera perdu.`)) return;
    await run(() => api.alerts.removeMany(ids), 'Échec de la suppression.');
    setSelected(new Set());
  };

  const resetFilters = () => {
    setSeverityFilter('all');
    setNodeFilter(ANY_NODE);
    setQuery('');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alertes"
        description="Les problèmes détectés sur la flotte par vos règles de seuil et par la supervision (liens, disques, agents). Résolvez-les une fois traités."
        meta={
          open.length > 0 ? (
            <StatusPill tone={counts.critical + counts.high > 0 ? 'danger' : 'warn'}>{open.length} à traiter</StatusPill>
          ) : (
            <StatusPill tone="ok">Rien à traiter</StatusPill>
          )
        }
      />

      {error && <Callout variant="danger">{error}</Callout>}

      {isLoading ? (
        <StatRow className="xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <StatCardSkeleton key={index} />
          ))}
        </StatRow>
      ) : (
        <StatRow className="animate-fade-in xl:grid-cols-4">
          <Stat label="Critiques" value={counts.critical} icon={AlertCircle} tone={counts.critical > 0 ? 'danger' : 'ok'} hint={counts.critical > 0 ? 'Intervention immédiate' : 'Aucune'} />
          <Stat label="Élevées" value={counts.high} icon={AlertCircle} tone={counts.high > 0 ? 'danger' : 'ok'} hint={counts.high > 0 ? 'À traiter rapidement' : 'Aucune'} />
          <Stat label="Moyennes et faibles" value={counts.minor} icon={AlertTriangle} tone={counts.minor > 0 ? 'warn' : 'ok'} hint={counts.minor > 0 ? 'À surveiller' : 'Aucune'} />
          <Stat label="Résolues sur 7 jours" value={counts.resolvedWeek} icon={ShieldCheck} hint={`${alerts.length} déclenchement${alerts.length > 1 ? 's' : ''} conservé${alerts.length > 1 ? 's' : ''}`} />
        </StatRow>
      )}

      <Card className="overflow-hidden">
        {/* Status is the primary partition - an operator opens this page to
            deal with what is unresolved, not to browse history. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 lg:px-5">
          <Tabs value={statusTab} onValueChange={(value) => setStatusTab(value as StatusTab)}>
            <TabsList variant="segmented">
              <TabsTrigger value="todo">
                À traiter <TabsCount>{open.length}</TabsCount>
              </TabsTrigger>
              <TabsTrigger value="resolved">Résolues</TabsTrigger>
              <TabsTrigger value="all">Toutes</TabsTrigger>
            </TabsList>
          </Tabs>
          <span className="flex-1" />
          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Message, nœud…" className="h-8 pl-8" />
          </div>
          <Select value={severityFilter} onValueChange={(value) => setSeverityFilter(value as SeverityFilter)}>
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes sévérités</SelectItem>
              {(['critical', 'high', 'medium', 'low'] as const).map((value) => (
                <SelectItem key={value} value={value}>
                  {describe(SEVERITY, value).label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {nodeOptions.length > 1 && (
            <Select value={nodeFilter} onValueChange={setNodeFilter}>
              <SelectTrigger className="h-8 w-44 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_NODE}>Tous les nœuds</SelectItem>
                {nodeOptions.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {shortHostname(name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {filtersActive && (
            <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1">
              <X className="h-3.5 w-3.5" />
              Effacer
            </Button>
          )}
        </div>

        {visible.length > 0 && (
          <div
            className={cn(
              'flex flex-wrap items-center gap-3 border-b border-border px-4 py-2 lg:px-5',
              selectedGroups.length > 0 ? 'bg-primary/[0.06]' : 'bg-surface-2/30',
            )}
          >
            <input
              type="checkbox"
              aria-label="Tout sélectionner"
              checked={allVisibleSelected}
              onChange={() =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (allVisibleSelected) visible.forEach((group) => next.delete(group.key));
                  else visible.forEach((group) => next.add(group.key));
                  return next;
                })
              }
              className="h-3.5 w-3.5 rounded border-border"
            />
            {selectedGroups.length > 0 ? (
              <>
                <span className="text-xs text-foreground">
                  {selectedGroups.length} sélectionnée{selectedGroups.length > 1 ? 's' : ''}
                  <span className="text-muted-foreground"> · {selectedIds.length} déclenchement{selectedIds.length > 1 ? 's' : ''}</span>
                </span>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => void ackGroups(selectedGroups)} className="gap-1.5">
                    <Eye className="h-3.5 w-3.5" />
                    Prendre en compte
                  </Button>
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => void resolveGroups(selectedGroups)} className="gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--ok))]" />
                    Résoudre
                  </Button>
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => void deleteGroups(selectedGroups)} className="gap-1.5 text-[hsl(var(--danger))]">
                    <Trash2 className="h-3.5 w-3.5" />
                    Supprimer
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                    Annuler
                  </Button>
                </div>
              </>
            ) : (
              <span className="text-2xs uppercase tracking-wider text-muted-foreground">
                {visible.length} alerte{visible.length > 1 ? 's' : ''}
                {statusTab === 'todo' ? ' à traiter, les plus graves en premier' : ''}
              </span>
            )}
          </div>
        )}

        {isLoading ? (
          <div className="p-4 lg:p-5">
            <ListSkeleton rows={5} />
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[hsl(var(--ok))]/10">
              <ShieldCheck className="h-5 w-5 text-[hsl(var(--ok))]" />
            </span>
            <p className="text-sm font-medium text-foreground">
              {filtersActive ? 'Aucune alerte ne correspond à ces filtres' : statusTab === 'resolved' ? 'Aucune alerte résolue' : 'Tout est calme'}
            </p>
            <p className="max-w-sm text-xs text-muted-foreground">
              {filtersActive
                ? 'Élargissez la recherche ou effacez les filtres.'
                : statusTab === 'todo'
                  ? 'Aucun problème en cours sur la flotte. Les nouvelles alertes apparaîtront ici dès leur déclenchement.'
                  : 'L’historique des alertes traitées apparaîtra ici.'}
            </p>
            {filtersActive && (
              <Button variant="secondary" size="sm" onClick={resetFilters} className="mt-1">
                Effacer les filtres
              </Button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((group) => (
              <AlertRow
                key={group.key}
                group={group}
                workspace={params.workspace}
                selected={selected.has(group.key)}
                expanded={expanded.has(group.key)}
                busy={busy}
                onToggleSelect={() => setSelected((prev) => toggle(prev, group.key))}
                onToggleExpand={() => setExpanded((prev) => toggle(prev, group.key))}
                onAck={() => void ackGroups([group])}
                onResolve={() => void resolveGroups([group])}
                onDelete={() => void deleteGroups([group])}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
