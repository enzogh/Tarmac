'use client';

import { useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, Bell, CheckCircle2, ChevronRight, Eye, Search, Trash2 } from 'lucide-react';
import { AlertItem, api } from '../../../../lib/api';
import { usePolling } from '../../../../lib/hooks/usePolling';
import { ALERT_STATUS, SEVERITY, StatusPill, describe } from '../../../../components/ui/status';
import { PageHeader } from '../../../../components/PageHeader';
import { Callout } from '../../../../components/Callout';
import { Stat, StatRow } from '../../../../components/ui/stat';
import { Card, CardContent } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '../../../../components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../components/ui/tooltip';
import { ListSkeleton, StatCardSkeleton } from '../../../../components/ui/skeleton';
import { formatDateTime, formatRelative } from '../../../../lib/format';
import { cn } from '../../../../lib/utils';

type SeverityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low';
type StatusTab = 'todo' | 'resolved' | 'all';

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * One row per recurring alert, not per occurrence.
 *
 * A rule that keeps firing writes a new row every time it does, so a fleet
 * with one flapping VLAN link produced dozens of byte-identical "Lien VLAN
 * hors ligne : A <-> B" alerts. Rendered one card each, the page became an
 * endless column in which nothing could be compared and the single critical
 * disk alert was indistinguishable from the fortieth copy of a link blip.
 * Collapsing on the message gives one line per distinct problem, carrying
 * how many times it fired and when it last did; the occurrences are still
 * there, one click away.
 */
type AlertGroup = {
  key: string;
  message: string;
  severity: string;
  /** Worst status across the group: an unread occurrence outranks a read one. */
  status: string;
  lastTriggeredAt: string;
  occurrences: AlertItem[];
};

function groupAlerts(alerts: AlertItem[]): AlertGroup[] {
  const byMessage = new Map<string, AlertItem[]>();
  for (const alert of alerts) {
    const list = byMessage.get(alert.message) ?? [];
    list.push(alert);
    byMessage.set(alert.message, list);
  }

  return [...byMessage.entries()]
    .map(([message, occurrences]) => {
      const sorted = [...occurrences].sort(
        (left, right) => new Date(right.triggeredAt).getTime() - new Date(left.triggeredAt).getTime(),
      );
      const status = sorted.some((alert) => alert.status === 'open')
        ? 'open'
        : sorted.some((alert) => alert.status === 'acknowledged')
          ? 'acknowledged'
          : 'resolved';
      const severity = sorted.reduce(
        (worst, alert) => ((SEVERITY_RANK[alert.severity] ?? 9) < (SEVERITY_RANK[worst] ?? 9) ? alert.severity : worst),
        sorted[0].severity,
      );
      return { key: message, message, severity, status, lastTriggeredAt: sorted[0].triggeredAt, occurrences: sorted };
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

export default function AlertsPage() {
  const { data: alerts = [], mutate, isLoading } = usePolling('alerts', api.alerts.list, { intervalMs: 20000 });

  const [statusTab, setStatusTab] = useState<StatusTab>('todo');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const critical = useMemo(
    () => alerts.filter((alert) => alert.status !== 'resolved' && alert.severity === 'critical').length,
    [alerts],
  );
  const warnings = useMemo(
    () =>
      alerts.filter(
        (alert) => alert.status !== 'resolved' && (alert.severity === 'high' || alert.severity === 'medium'),
      ).length,
    [alerts],
  );

  const groups = useMemo(() => groupAlerts(alerts), [alerts]);
  const todoCount = useMemo(() => groups.filter((group) => group.status !== 'resolved').length, [groups]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return groups.filter((group) => {
      if (statusTab === 'todo' && group.status === 'resolved') return false;
      if (statusTab === 'resolved' && group.status !== 'resolved') return false;
      if (severityFilter !== 'all' && group.severity !== severityFilter) return false;
      if (needle && !group.message.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [groups, statusTab, severityFilter, query]);

  const allVisibleSelected = visible.length > 0 && visible.every((group) => selected.has(group.key));
  const selectedGroups = useMemo(() => visible.filter((group) => selected.has(group.key)), [visible, selected]);
  const selectedIds = useMemo(
    () => selectedGroups.flatMap((group) => group.occurrences.map((alert) => alert.id)),
    [selectedGroups],
  );

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
  const ackGroup = (group: AlertGroup) =>
    run(
      () => Promise.all(group.occurrences.filter((a) => a.status === 'open').map((a) => api.alerts.ack(a.id))),
      'Échec de la prise en compte.',
    );

  const resolveGroup = (group: AlertGroup) =>
    run(
      () => Promise.all(group.occurrences.filter((a) => a.status !== 'resolved').map((a) => api.alerts.resolve(a.id))),
      'Échec de la résolution.',
    );

  const deleteGroup = (group: AlertGroup) =>
    run(() => api.alerts.removeMany(group.occurrences.map((a) => a.id)), 'Échec de la suppression.');

  const bulkResolve = () =>
    run(
      () =>
        Promise.all(
          selectedGroups.flatMap((group) =>
            group.occurrences.filter((a) => a.status !== 'resolved').map((a) => api.alerts.resolve(a.id)),
          ),
        ),
      'Échec de la résolution groupée.',
    );

  const bulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Supprimer définitivement ${selectedIds.length} alerte(s) ?`)) return;
    await run(() => api.alerts.removeMany(selectedIds), 'Échec de la suppression groupée.');
    setSelected(new Set());
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alertes"
        description="Notifications déclenchées par vos règles de seuil (CPU, RAM, espace disque…)."
        meta={
          todoCount > 0 ? (
            <StatusPill tone={critical > 0 ? 'danger' : 'warn'}>{todoCount} à traiter</StatusPill>
          ) : (
            <StatusPill tone="ok">Rien à traiter</StatusPill>
          )
        }
      />

      {error && <Callout variant="danger">{error}</Callout>}

      {isLoading ? (
        <StatRow className="xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <StatCardSkeleton key={index} />
          ))}
        </StatRow>
      ) : (
        <StatRow className="animate-fade-in xl:grid-cols-3">
          <Stat
            label="Critiques actives"
            value={critical}
            icon={AlertCircle}
            tone={critical > 0 ? 'danger' : 'ok'}
            hint={critical > 0 ? 'Intervention requise' : 'Aucune'}
          />
          <Stat
            label="Avertissements actifs"
            value={warnings}
            icon={AlertTriangle}
            tone={warnings > 0 ? 'warn' : 'ok'}
            hint={warnings > 0 ? 'À surveiller' : 'Aucun'}
          />
          <Stat
            label="Alertes distinctes"
            value={groups.length}
            icon={Bell}
            hint={`${alerts.length} déclenchement${alerts.length > 1 ? 's' : ''} au total`}
          />
        </StatRow>
      )}

      <Card>
        {/* Status is the primary partition - an operator opens this page to
            deal with what is unresolved, not to browse history - so it is a
            tab rather than one more dropdown among the filters. */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 lg:px-5">
          <Tabs value={statusTab} onValueChange={(value) => setStatusTab(value as StatusTab)}>
            <TabsList variant="segmented">
              <TabsTrigger value="todo">À traiter ({todoCount})</TabsTrigger>
              <TabsTrigger value="resolved">Résolues</TabsTrigger>
              <TabsTrigger value="all">Toutes</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Rechercher…"
                className="h-8 w-48 pl-8"
              />
            </div>
            <Select value={severityFilter} onValueChange={(value) => setSeverityFilter(value as SeverityFilter)}>
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes sévérités</SelectItem>
                <SelectItem value="critical">{describe(SEVERITY, 'critical').label}</SelectItem>
                <SelectItem value="high">{describe(SEVERITY, 'high').label}</SelectItem>
                <SelectItem value="medium">{describe(SEVERITY, 'medium').label}</SelectItem>
                <SelectItem value="low">{describe(SEVERITY, 'low').label}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* The selection bar replaces the header's contents while a selection
            exists, instead of a "Tout sélectionner" checkbox sitting next to
            the filters with no visible consequence. */}
        {selectedGroups.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-b border-border bg-primary/5 px-4 py-2 lg:px-5">
            <span className="text-xs text-foreground">
              {selectedGroups.length} alerte{selectedGroups.length > 1 ? 's' : ''} sélectionnée
              {selectedGroups.length > 1 ? 's' : ''}
              <span className="text-muted-foreground"> · {selectedIds.length} déclenchements</span>
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => void bulkResolve()} className="gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Résoudre
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => void bulkDelete()}
                className="gap-1.5 text-[hsl(var(--danger))]"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Supprimer
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                Annuler
              </Button>
            </div>
          </div>
        )}

        <CardContent flush>
          {isLoading ? (
            <div className="p-4 lg:p-5">
              <ListSkeleton rows={5} />
            </div>
          ) : visible.length === 0 ? (
            <p className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-[hsl(var(--ok))]" />
              {alerts.length === 0
                ? 'Aucune alerte'
                : statusTab === 'todo'
                  ? 'Rien à traiter'
                  : 'Aucune alerte ne correspond aux filtres'}
            </p>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-border px-4 py-2 lg:px-5">
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
                <span className="text-2xs uppercase tracking-wider text-muted-foreground">
                  {visible.length} alerte{visible.length > 1 ? 's' : ''}
                </span>
              </div>

              <ul className="divide-y divide-border">
                {visible.map((group) => {
                  const severity = describe(SEVERITY, group.severity);
                  const status = describe(ALERT_STATUS, group.status);
                  const isExpanded = expanded.has(group.key);
                  return (
                    <li key={group.key} className="group/row">
                      <div
                        className={cn(
                          'flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2 lg:px-5',
                          selected.has(group.key) && 'bg-primary/5',
                        )}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Sélectionner « ${group.message} »`}
                          checked={selected.has(group.key)}
                          onChange={() => setSelected((prev) => toggle(prev, group.key))}
                          className="h-3.5 w-3.5 shrink-0 rounded border-border"
                        />

                        <StatusPill tone={severity.tone} dot={false} className="w-20 shrink-0 justify-center">
                          {severity.label}
                        </StatusPill>

                        <button
                          type="button"
                          onClick={() => setExpanded((prev) => toggle(prev, group.key))}
                          disabled={group.occurrences.length === 1}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
                        >
                          {group.occurrences.length > 1 && (
                            <ChevronRight
                              className={cn(
                                'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                                isExpanded && 'rotate-90',
                              )}
                            />
                          )}
                          <span className="truncate text-sm text-foreground" title={group.message}>
                            {group.message}
                          </span>
                          {group.occurrences.length > 1 && (
                            <span className="tabular shrink-0 rounded border border-border bg-surface-2 px-1.5 text-2xs text-muted-foreground">
                              ×{group.occurrences.length}
                            </span>
                          )}
                        </button>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="tabular w-24 shrink-0 cursor-default text-right text-2xs text-muted-foreground">
                              {formatRelative(group.lastTriggeredAt)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            Dernier déclenchement : {formatDateTime(group.lastTriggeredAt)}
                          </TooltipContent>
                        </Tooltip>

                        <StatusPill tone={status.tone} className="w-32 shrink-0 justify-center">
                          {status.label}
                        </StatusPill>

                        {/* Revealed on hover and focus: three labelled buttons
                            on every row turned the list into a wall of
                            controls instead of a list of problems. The gutter
                            keeps its width whichever actions a row gets, so
                            every column before it lines up from row to row. */}
                        <div className="flex w-[100px] shrink-0 items-center justify-end gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100">
                          {group.status === 'open' && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" disabled={busy} onClick={() => void ackGroup(group)}>
                                  <Eye className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Marquer comme prise en compte</TooltipContent>
                            </Tooltip>
                          )}
                          {group.status !== 'resolved' && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  disabled={busy}
                                  onClick={() => void resolveGroup(group)}
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Résoudre</TooltipContent>
                            </Tooltip>
                          )}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={busy}
                                onClick={() => void deleteGroup(group)}
                                className="text-muted-foreground hover:text-[hsl(var(--danger))]"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Supprimer définitivement</TooltipContent>
                          </Tooltip>
                        </div>
                      </div>

                      {isExpanded && (
                        <ul className="border-t border-border bg-surface-2/50 px-4 py-2 lg:px-5">
                          {group.occurrences.map((alert) => {
                            const occurrenceStatus = describe(ALERT_STATUS, alert.status);
                            return (
                              <li
                                key={alert.id}
                                className="flex items-center gap-3 py-1 pl-[6.5rem] text-2xs text-muted-foreground"
                              >
                                <span className="tabular">{formatDateTime(alert.triggeredAt)}</span>
                                <StatusPill tone={occurrenceStatus.tone} dot={false}>
                                  {occurrenceStatus.label}
                                </StatusPill>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
