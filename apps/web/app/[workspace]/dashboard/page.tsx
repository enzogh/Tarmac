'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRightLeft,
  Bell,
  CheckCircle2,
  Cpu,
  Gauge,
  HardDrive,
  LayoutDashboard,
  Network,
  RefreshCcw,
  Server,
} from 'lucide-react';
import { api, NodeMetricSample } from '../../../lib/api';
import { usePolling } from '../../../lib/hooks/usePolling';
import { PageHeader } from '../../../components/PageHeader';
import { ServerTrendCard } from '../../../components/ServerTrendCard';
import { FleetPerformanceChart, NetworkThroughputChart, StorageBreakdownChart } from '../../../components/dashboard-charts';
import { StatCard, Badge } from '../../../components/ui';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Progress } from '../../../components/ui/progress';
import { CardListSkeleton, ChartCardSkeleton, ListSkeleton, StatCardSkeleton } from '../../../components/ui/skeleton';
import { readNodeLabels } from '../../../lib/node-labels';
import { SectionLabel } from '../../../components/SectionLabel';

const formatTime = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

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

  const { data: activities = [], isLoading: activitiesLoading } = usePolling('activity:1h', () => api.nodes.activity());
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

  return (
      <div className="space-y-10">
        <PageHeader
          icon={LayoutDashboard}
          title="Vue d'ensemble"
          description="État en direct de votre flotte de nœuds : capacité, charge, alertes et travaux en cours."
        />

        <section className="space-y-4">
          <SectionLabel>Aperçu</SectionLabel>
          {overviewLoading ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <StatCardSkeleton key={index} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 animate-fade-in">
              <StatCard
                label="Nœuds en ligne"
                value={activities.length > 0 ? `${nodesOnline}/${activities.length}` : '-'}
                icon={<Server className="h-8 w-8" />}
                changeType="up"
              />
              <StatCard
                label="Stockage total utilisé"
                value={`${activities.reduce((acc, node) => acc + node.storage.totalUsedGb, 0)} GB`}
                icon={<HardDrive className="h-8 w-8" />}
                change={`${activities.reduce((acc, node) => acc + node.storage.totalCapacityGb, 0)} GB total`}
                changeType="neutral"
              />
              <StatCard
                label="Alertes actives"
                value={activeAlerts.length}
                icon={<Bell className="h-8 w-8" />}
                change={alertsCritical > 0 ? `${alertsCritical} critiques` : `${alertsWarning} avertissements`}
                changeType={alertsCritical > 0 ? 'down' : alertsWarning > 0 ? 'neutral' : 'up'}
              />
              <StatCard
                label="Migrations en cours"
                value={migrationsActive}
                icon={<ArrowRightLeft className="h-8 w-8" />}
                changeType="neutral"
              />
            </div>
          )}
        </section>

        <section className="space-y-4">
          <SectionLabel>Performance</SectionLabel>
          {performanceLoading ? (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <ChartCardSkeleton />
              <ChartCardSkeleton />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 animate-fade-in">
              <Card className="border-white/[0.08] bg-panel-glow transition-colors hover:border-white/[0.14]">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Cpu className="h-5 w-5 text-violet-400" />
                    <CardTitle className="text-base">CPU &amp; RAM de la flotte</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <FleetPerformanceChart data={performanceSeries} />
                </CardContent>
              </Card>
              <Card className="border-white/[0.08] bg-panel-glow transition-colors hover:border-white/[0.14]">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Network className="h-5 w-5 text-violet-400" />
                    <CardTitle className="text-base">Débit réseau</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <NetworkThroughputChart data={networkSeries} />
                </CardContent>
              </Card>
            </div>
          )}
        </section>

        <section className="space-y-4">
          <SectionLabel>Stockage &amp; alertes</SectionLabel>
          {storageAndAlertsLoading ? (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <ChartCardSkeleton />
              <ChartCardSkeleton height="h-48" />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 animate-fade-in">
              <Card className="border-white/[0.08] bg-panel-glow transition-colors hover:border-white/[0.14]">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Gauge className="h-5 w-5 text-violet-400" />
                    <CardTitle className="text-base">Répartition du stockage par nœud</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <StorageBreakdownChart data={storageSlices} />
                </CardContent>
              </Card>

              <Card className="border-white/[0.08] bg-panel-glow transition-colors hover:border-white/[0.14]">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Bell className="h-5 w-5 text-violet-400" />
                    <CardTitle className="text-base">Alertes récentes</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {activeAlerts.slice(0, 5).map((alert) => (
                    <div
                      key={alert.id}
                      className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3"
                    >
                      <div className="flex-1">
                        <p className="text-sm font-medium text-foreground">{alert.message}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{alert.status}</p>
                      </div>
                      <Badge
                        label={alert.severity}
                        type={alert.severity === 'critical' ? 'error' : alert.severity === 'high' ? 'warning' : 'info'}
                      />
                    </div>
                  ))}
                  {activeAlerts.length === 0 && (
                    <div className="flex items-center justify-center gap-2 py-4 text-sm text-emerald-400">
                      <CheckCircle2 className="h-4 w-4" />
                      Aucune alerte active
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </section>

        <section className="space-y-4">
          <SectionLabel>Serveurs actifs</SectionLabel>
          {spotlightLoading ? (
            <CardListSkeleton cards={4} />
          ) : (
            <Card className="border-white/[0.08] bg-panel-glow transition-colors hover:border-white/[0.14] animate-fade-in">
              <CardContent className="pt-6">
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <AnimatePresence initial={false}>
                    {spotlightNodes.map((node) => (
                      <motion.div
                        key={node.id}
                        layout
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        transition={{ duration: 0.25, ease: 'easeOut' }}
                      >
                        <ServerTrendCard
                          node={node}
                          samples={samplesByNode[node.id] ?? []}
                          labels={nodeLabels[node.id] ?? []}
                        />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  {spotlightNodes.length === 0 && (
                    <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
                      Aucun serveur n’a encore remonté d’activité.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </section>

        <section className="space-y-4">
          <SectionLabel>Activité</SectionLabel>
          {activityFeedLoading ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card className="border-white/[0.08] bg-panel-glow transition-colors hover:border-white/[0.14]">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <RefreshCcw className="h-5 w-5 text-violet-400" />
                    <CardTitle className="text-base">Travaux de synchronisation</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <ListSkeleton rows={3} />
                </CardContent>
              </Card>
              <Card className="border-white/[0.08] bg-panel-glow transition-colors hover:border-white/[0.14]">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <ArrowRightLeft className="h-5 w-5 text-violet-400" />
                    <CardTitle className="text-base">Migrations en cours</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <ListSkeleton rows={3} />
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 animate-fade-in">
              <Card className="border-white/[0.08] bg-panel-glow transition-colors hover:border-white/[0.14]">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <RefreshCcw className="h-5 w-5 text-violet-400" />
                    <CardTitle className="text-base">Travaux de synchronisation</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {syncJobs.slice(0, 5).map((job) => (
                    <div
                      key={job.id}
                      className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">{job.name}</p>
                        <p className="text-xs text-muted-foreground">{job.sourcePath}</p>
                      </div>
                      <Badge label={job.status} type="info" />
                    </div>
                  ))}
                  {syncJobs.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">Aucun travail</p>}
                </CardContent>
              </Card>

              <Card className="border-white/[0.08] bg-panel-glow transition-colors hover:border-white/[0.14]">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <ArrowRightLeft className="h-5 w-5 text-violet-400" />
                    <CardTitle className="text-base">Migrations en cours</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {activeMigrations.slice(0, 5).map((migration) => (
                    <div key={migration.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-sm font-medium text-foreground">{migration.name}</p>
                        <span className="text-xs text-muted-foreground">{migration.progress}%</span>
                      </div>
                      <Progress
                        value={migration.progress}
                        className="h-1.5 bg-emerald-500/20 [&>div]:from-emerald-500 [&>div]:to-emerald-300"
                      />
                    </div>
                  ))}
                  {activeMigrations.length === 0 && (
                    <p className="py-4 text-center text-sm text-muted-foreground">Aucune migration</p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </section>
      </div>
  );
}
