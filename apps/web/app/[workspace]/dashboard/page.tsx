'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRightLeft,
  Bell,
  CheckCircle2,
  HardDrive,
  RefreshCcw,
  Server,
} from 'lucide-react';
import { api, NodeActivityItem, NodeHeartbeatLiveEvent, NodeMetricSample } from '../../../lib/api';
import { usePolling } from '../../../lib/hooks/usePolling';
import { useLiveSocket } from '../../../lib/hooks/useLiveSocket';
import { PageHeader } from '../../../components/PageHeader';
import { ServerTrendCard } from '../../../components/ServerTrendCard';
import { FleetPerformanceChart, NetworkThroughputChart, StorageBreakdownChart } from '../../../components/dashboard-charts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Stat, StatRow } from '../../../components/ui/stat';
import { ALERT_STATUS, RESOURCE_STATUS, SEVERITY, StatusPill, describe } from '../../../components/ui/status';
import { Progress } from '../../../components/ui/progress';
import { CardListSkeleton, ChartCardSkeleton, ListSkeleton, StatCardSkeleton } from '../../../components/ui/skeleton';
import { readNodeLabels } from '../../../lib/node-labels';
import { SectionLabel } from '../../../components/SectionLabel';
import { formatCapacityGb, formatInt, formatRelative, formatTime as formatClock } from '../../../lib/format';

const formatTime = (iso: string) => formatClock(iso);

// Network I/O is naturally bursty sample-to-sample; a trailing moving average
// smooths the chart into a readable trend instead of a jagged spike train,
// without looking ahead at future samples.
function smoothSeries<T extends Record<string, number | string>>(
  points: T[],
  keys: Array<keyof T>,
  window = 5,
): T[] {
  return points.map((point, index) => {
    const start = Math.max(0, index - window + 1);
    const slice = points.slice(start, index + 1);
    const smoothed = { ...point };
    for (const key of keys) {
      const sum = slice.reduce((acc, p) => acc + (p[key] as number), 0);
      smoothed[key] = (sum / slice.length) as T[typeof key];
    }
    return smoothed;
  });
}

export default function OverviewPage() {
  const [nodeLabels, setNodeLabels] = useState<Record<string, string[]>>({});

  useEffect(() => {
    setNodeLabels(readNodeLabels());
  }, []);

  const {
    data: activitiesRaw,
    isLoading: activitiesLoading,
    mutate: mutateActivities,
  } = usePolling('activity:1h', () => api.nodes.activity());
  const activities = activitiesRaw ?? [];

  // Patches the polled activity cache the instant a heartbeat arrives
  // instead of waiting up to 5s for the next poll tick - see
  // AgentsService.onHeartbeat's 'node.heartbeat' broadcast. Polling keeps
  // running as the source of truth/fallback; this is purely additive.
  //
  // Bails out entirely if the first real poll hasn't landed yet
  // (activitiesRaw still undefined) - calling mutate() with an updater that
  // can produce `undefined` (current?.map(...) short-circuits to undefined
  // when current is undefined) sets the SWR cache to undefined, and with 5
  // nodes heartbeating every ~5s a live message reliably arrives before the
  // very first fetch resolves. That poisoned the cache permanently: every
  // subsequent poll response lost SWR's in-flight-vs-mutated race against
  // the next (more frequent) heartbeat, so real data never stuck and the
  // dashboard showed 0 nodes forever despite the API and the socket both
  // working correctly.
  useLiveSocket((message) => {
    if (message.type !== 'node.heartbeat') return;
    if (!activitiesRaw) return;
    const update = message.payload as NodeHeartbeatLiveEvent;
    void mutateActivities(
      (current) =>
        current?.map((node): NodeActivityItem =>
          node.id === update.nodeId
            ? {
                ...node,
                status: update.status,
                lastSeenAt: update.lastSeenAt,
                agentVersion: update.agentVersion,
                agentVersionAt: update.agentVersionAt,
                agentUpToDate:
                  update.agentVersion && node.controlVersion ? update.agentVersion === node.controlVersion : null,
                metrics: { ...update.metrics, sampledAt: update.lastSeenAt },
              }
            : node,
        ) ?? current,
      { revalidate: false },
    );
  });
  const { data: alerts = [], isLoading: alertsLoading } = usePolling('alerts', api.alerts.list, { intervalMs: 20000 });
  const { data: syncJobs = [], isLoading: syncJobsLoading } = usePolling('sync-jobs', api.syncJobs.list, { intervalMs: 20000 });
  const { data: migrations = [], isLoading: migrationsLoading } = usePolling('migrations', api.migrations.list, { intervalMs: 20000 });

  const sortedByCpu = useMemo(
    () => [...activities].sort((left, right) => right.metrics.cpu - left.metrics.cpu),
    [activities],
  );
  const topNodeIds = useMemo(() => sortedByCpu.slice(0, 4).map((node) => node.id), [sortedByCpu]);
  const spotlightNodes = useMemo(() => sortedByCpu.slice(0, 4), [sortedByCpu]);
  // Sorted independently of the CPU ranking above: the *set* of top-4 nodes
  // rarely changes, but their relative CPU order shuffles almost every poll.
  // Keying on the unsorted order turned every reshuffle into a brand-new SWR
  // cache key (fresh "loading" state -> chart/skeleton flash every few
  // seconds). Keying on the sorted set instead only changes when a node
  // actually enters/leaves the top 4.
  const topNodeIdsKey = useMemo(() => [...topNodeIds].sort().join(','), [topNodeIds]);

  const { data: samplesByNode = {}, isLoading: samplesLoading } = usePolling(
    topNodeIds.length > 0 ? `metrics:${topNodeIdsKey}:6h` : null,
    async () => {
      const histories = await Promise.all(
        topNodeIds.map(async (id) => [id, await api.nodes.metrics(id, '6h')] as const),
      );
      return Object.fromEntries(histories) as Record<string, NodeMetricSample[]>;
    },
    // A 6h trend chart doesn't need sub-20s freshness, and this is the
    // heaviest poll on the page (up to 4 nodes' full history per tick) -
    // the default 5s interval was mostly re-fetching data that hadn't
    // meaningfully changed since the last tick.
    { intervalMs: 20000 },
  );

  const overviewLoading = activitiesLoading || alertsLoading || migrationsLoading;
  const performanceLoading = activitiesLoading || samplesLoading;
  const storageAndAlertsLoading = activitiesLoading || alertsLoading;
  const spotlightLoading = activitiesLoading || samplesLoading;
  const activityFeedLoading = syncJobsLoading || migrationsLoading;

  const nodesOnline = useMemo(() => activities.filter((node) => node.status === 'online').length, [activities]);
  // "Actives" means not yet resolved — open (unread) and acknowledged (read
  // but still pending) both count; only resolved alerts drop off.
  const activeAlerts = useMemo(() => alerts.filter((a) => a.status !== 'resolved'), [alerts]);
  const alertsCritical = useMemo(
    () => activeAlerts.filter((a) => a.severity === 'critical').length,
    [activeAlerts],
  );
  const alertsWarning = useMemo(() => activeAlerts.filter((a) => a.severity === 'high').length, [activeAlerts]);
  const activeMigrations = useMemo(
    () =>
      migrations.filter(
        (migration) =>
          (migration.status === 'pending' || migration.status === 'running') && migration.progress < 100,
      ),
    [migrations],
  );
  const migrationsActive = activeMigrations.length;

  // Les nœuds remontent leurs mesures à des instants légèrement différents : on aligne les séries
  // par index (même paramètre `range` pour tous) plutôt que par timestamp exact, ce qui suffit pour
  // une tendance de flotte lisible sans complexifier l'agrégation.
  const alignedSamples = useMemo(() => {
    const nodeSeries = Object.values(samplesByNode);
    const seriesLength = nodeSeries.reduce((max, series) => Math.max(max, series.length), 0);
    return Array.from({ length: seriesLength }, (_, index) =>
      nodeSeries.map((series) => series[index]).filter((sample): sample is NodeMetricSample => Boolean(sample)),
    );
  }, [samplesByNode]);

  const performanceSeries = useMemo(
    () =>
      alignedSamples.map((samples) => {
        const cpu = samples.length > 0 ? samples.reduce((sum, s) => sum + s.cpu, 0) / samples.length : 0;
        const ram = samples.length > 0 ? samples.reduce((sum, s) => sum + s.ram, 0) / samples.length : 0;
        return { label: samples[0] ? formatTime(samples[0].createdAt) : '', cpu, ram };
      }),
    [alignedSamples],
  );

  const networkSeries = useMemo(
    () =>
      smoothSeries(
        alignedSamples.map((samples) => {
          const rx = samples.length > 0 ? samples.reduce((sum, s) => sum + s.networkRx, 0) / samples.length : 0;
          const tx = samples.length > 0 ? samples.reduce((sum, s) => sum + s.networkTx, 0) / samples.length : 0;
          return {
            label: samples[0] ? formatTime(samples[0].createdAt) : '',
            rx: (rx * 8) / 1_000_000,
            tx: (tx * 8) / 1_000_000,
          };
        }),
        ['rx', 'tx'],
      ),
    [alignedSamples],
  );

  const storageSlices = useMemo(
    () =>
      activities
        .filter((node) => node.storage.totalUsedGb > 0)
        .map((node) => ({ name: node.name, value: node.storage.totalUsedGb })),
    [activities],
  );

  const totalUsedGb = useMemo(
    () => activities.reduce((sum, node) => sum + node.storage.totalUsedGb, 0),
    [activities],
  );
  const totalCapacityGb = useMemo(
    () => activities.reduce((sum, node) => sum + node.storage.totalCapacityGb, 0),
    [activities],
  );
  const usedCapacity = formatCapacityGb(totalUsedGb);
  const usageRatio = totalCapacityGb > 0 ? (totalUsedGb / totalCapacityGb) * 100 : 0;
  const nodesDown = activities.length - nodesOnline;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Vue d&apos;ensemble"
        description="État en direct de votre flotte de nœuds : capacité, charge, alertes et travaux en cours."
        meta={
          activities.length > 0 && (
            <StatusPill tone={nodesDown > 0 ? 'warn' : 'ok'}>
              {nodesDown > 0 ? `${nodesDown} nœud${nodesDown > 1 ? 's' : ''} à vérifier` : 'Flotte nominale'}
            </StatusPill>
          )
        }
      />

      {overviewLoading ? (
        <StatRow>
          {Array.from({ length: 4 }).map((_, index) => (
            <StatCardSkeleton key={index} />
          ))}
        </StatRow>
      ) : (
        <StatRow className="animate-fade-in">
          <Stat
            label="Nœuds en ligne"
            value={activities.length > 0 ? nodesOnline : '—'}
            unit={activities.length > 0 ? `/ ${activities.length}` : undefined}
            icon={Server}
            tone={nodesDown > 0 ? 'warn' : 'ok'}
            hint={nodesDown > 0 ? `${nodesDown} hors ligne ou dégradé${nodesDown > 1 ? 's' : ''}` : 'Tous les agents répondent'}
          />
          <Stat
            label="Stockage utilisé"
            value={usedCapacity.value}
            unit={usedCapacity.unit}
            icon={HardDrive}
            tone={usageRatio >= 85 ? 'danger' : usageRatio >= 70 ? 'warn' : 'neutral'}
            hint={`${Math.round(usageRatio)} % de ${formatInt(totalCapacityGb)} GB`}
          />
          <Stat
            label="Alertes actives"
            value={activeAlerts.length}
            icon={Bell}
            tone={alertsCritical > 0 ? 'danger' : activeAlerts.length > 0 ? 'warn' : 'ok'}
            hint={
              alertsCritical > 0
                ? `${alertsCritical} critique${alertsCritical > 1 ? 's' : ''}`
                : alertsWarning > 0
                  ? `${alertsWarning} élevée${alertsWarning > 1 ? 's' : ''}`
                  : 'Rien à traiter'
            }
          />
          <Stat
            label="Migrations en cours"
            value={migrationsActive}
            icon={ArrowRightLeft}
            tone={migrationsActive > 0 ? 'info' : 'neutral'}
            hint={migrationsActive > 0 ? 'Transferts actifs' : 'Aucun transfert'}
          />
        </StatRow>
      )}

      <section className="space-y-3">
        <SectionLabel>Performance · 6 dernières heures</SectionLabel>
        {performanceLoading ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ChartCardSkeleton />
            <ChartCardSkeleton />
          </div>
        ) : (
          <div className="grid animate-fade-in grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Charge CPU &amp; RAM</CardTitle>
                <CardDescription>Moyenne sur les nœuds les plus sollicités</CardDescription>
              </CardHeader>
              <CardContent>
                <FleetPerformanceChart data={performanceSeries} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Débit réseau</CardTitle>
                <CardDescription>Mégabits par seconde, lissé sur 5 points</CardDescription>
              </CardHeader>
              <CardContent>
                <NetworkThroughputChart data={networkSeries} />
              </CardContent>
            </Card>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionLabel>Stockage &amp; alertes</SectionLabel>
        {storageAndAlertsLoading ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <ChartCardSkeleton />
            <ChartCardSkeleton height="h-48" />
          </div>
        ) : (
          <div className="grid animate-fade-in grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Répartition du stockage</CardTitle>
                <CardDescription>Volume occupé par nœud</CardDescription>
              </CardHeader>
              <CardContent>
                <StorageBreakdownChart data={storageSlices} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Alertes récentes</CardTitle>
                {activeAlerts.length > 5 && (
                  <span className="text-2xs text-muted-foreground">5 sur {activeAlerts.length}</span>
                )}
              </CardHeader>
              <CardContent className="p-0">
                {activeAlerts.length === 0 ? (
                  <p className="flex items-center justify-center gap-2 py-10 text-sm text-[hsl(var(--ok))]">
                    <CheckCircle2 className="h-4 w-4" />
                    Aucune alerte active
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {activeAlerts.slice(0, 5).map((alert) => {
                      const severity = describe(SEVERITY, alert.severity);
                      const status = describe(ALERT_STATUS, alert.status);
                      return (
                        <li key={alert.id} className="flex items-start gap-3 px-4 py-3 lg:px-5">
                          <StatusPill tone={severity.tone} dot={false} className="mt-0.5 shrink-0">
                            {severity.label}
                          </StatusPill>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm leading-snug text-foreground">{alert.message}</p>
                            <p className="mt-1 text-2xs text-muted-foreground">
                              {status.label} · {formatRelative(alert.triggeredAt)}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionLabel>Nœuds les plus sollicités</SectionLabel>
        {spotlightLoading ? (
          <CardListSkeleton cards={4} />
        ) : spotlightNodes.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Aucun serveur n’a encore remonté d’activité.
            </CardContent>
          </Card>
        ) : (
          <div className="grid animate-fade-in grid-cols-1 gap-4 xl:grid-cols-2">
            <AnimatePresence initial={false}>
              {spotlightNodes.map((node) => (
                <motion.div
                  key={node.id}
                  layout
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                  <ServerTrendCard
                    node={node}
                    samples={samplesByNode[node.id] ?? []}
                    labels={nodeLabels[node.id] ?? []}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionLabel>Travaux en cours</SectionLabel>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>
                <RefreshCcw className="h-4 w-4 text-muted-foreground" />
                Synchronisations
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {activityFeedLoading ? (
                <div className="p-4 lg:p-5">
                  <ListSkeleton rows={3} />
                </div>
              ) : syncJobs.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">Aucun travail configuré</p>
              ) : (
                <ul className="divide-y divide-border">
                  {syncJobs.slice(0, 5).map((job) => {
                    const status = describe(RESOURCE_STATUS, job.status);
                    return (
                      <li key={job.id} className="flex items-center gap-3 px-4 py-3 lg:px-5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">{job.name}</p>
                          <p className="truncate font-mono text-2xs text-muted-foreground">{job.sourcePath}</p>
                        </div>
                        <span className="shrink-0 text-2xs text-muted-foreground">{formatRelative(job.lastRunAt)}</span>
                        <StatusPill tone={status.tone} className="shrink-0">
                          {status.label}
                        </StatusPill>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
                Migrations
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {activityFeedLoading ? (
                <div className="p-4 lg:p-5">
                  <ListSkeleton rows={3} />
                </div>
              ) : activeMigrations.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">Aucune migration en cours</p>
              ) : (
                <ul className="divide-y divide-border">
                  {activeMigrations.slice(0, 5).map((migration) => (
                    <li key={migration.id} className="px-4 py-3 lg:px-5">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="truncate text-sm font-medium text-foreground">{migration.name}</p>
                        <span className="tabular shrink-0 text-xs text-muted-foreground">{migration.progress} %</span>
                      </div>
                      <Progress value={migration.progress} className="h-1" />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
