'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRightLeft,
  Bell,
  CheckCircle2,
  Cpu,
  Gauge,
  HardDrive,
  LayoutDashboard,
  Network,
  Server,
} from 'lucide-react';
import {
  api,
  AlertItem,
  MigrationItem,
  NodeActivityItem,
  NodeMetricSample,
  SyncJobItem,
} from '../../lib/api';
import { DashboardLayout } from '../../components/DashboardLayout';
import { PageHeader } from '../../components/PageHeader';
import { Callout } from '../../components/Callout';
import { ServerTrendCard } from '../../components/ServerTrendCard';
import { FleetPerformanceChart, NetworkThroughputChart, StorageBreakdownChart } from '../../components/dashboard-charts';
import { StatCard, Badge } from '../../components/ui';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Progress } from '../../components/ui/progress';
import { readNodeLabels } from '../../lib/node-labels';

const formatTime = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

function SectionLabel({ children }: { children: string }) {
  return <p className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-400">{children}</p>;
}

export default function OverviewPage() {
  const router = useRouter();
  const token = useMemo(() => (typeof window !== 'undefined' ? localStorage.getItem('tarmac_token') : null), []);

  const [activities, setActivities] = useState<NodeActivityItem[]>([]);
  const [samplesByNode, setSamplesByNode] = useState<Record<string, NodeMetricSample[]>>({});
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [syncJobs, setSyncJobs] = useState<SyncJobItem[]>([]);
  const [migrations, setMigrations] = useState<MigrationItem[]>([]);
  const [nodeLabels, setNodeLabels] = useState<Record<string, string[]>>({});

  useEffect(() => {
    setNodeLabels(readNodeLabels());
  }, []);

  const load = async () => {
    if (!token) return;
    try {
      const [activity, a, sj, mg] = await Promise.all([
        api.nodes.activity(token),
        api.alerts.list(token),
        api.syncJobs.list(token),
        api.migrations.list(token),
      ]);
      const topNodes = [...activity].sort((left, right) => right.metrics.cpu - left.metrics.cpu).slice(0, 4);
      const histories = await Promise.all(
        topNodes.map(async (node) => [node.id, await api.nodes.metrics(token, node.id, '6h')] as const),
      );
      setActivities(activity);
      setSamplesByNode(Object.fromEntries(histories));
      setAlerts(a);
      setSyncJobs(sj);
      setMigrations(mg);
    } catch {
      localStorage.removeItem('tarmac_token');
      router.push('/login');
    }
  };

  useEffect(() => {
    if (!token) {
      router.push('/login');
      return;
    }
    void load();
    const id = setInterval(() => {
      void load();
    }, 5000);
    return () => clearInterval(id);
  }, [token]);

  const nodesOnline = activities.filter((node) => node.status === 'online').length;
  const alertsCritical = alerts.filter((a) => a.severity === 'critical').length;
  const alertsWarning = alerts.filter((a) => a.severity === 'high').length;
  const activeMigrations = migrations.filter(
    (migration) =>
      (migration.status === 'pending' || migration.status === 'running') && migration.progress < 100,
  );
  const migrationsActive = activeMigrations.length;
  const spotlightNodes = [...activities].sort((left, right) => right.metrics.cpu - left.metrics.cpu).slice(0, 4);

  // Les nœuds remontent leurs mesures à des instants légèrement différents : on aligne les séries
  // par index (même paramètre `range` pour tous) plutôt que par timestamp exact, ce qui suffit pour
  // une tendance de flotte lisible sans complexifier l'agrégation.
  const nodeSeries = Object.values(samplesByNode);
  const seriesLength = nodeSeries.reduce((max, series) => Math.max(max, series.length), 0);
  const alignedSamples = Array.from({ length: seriesLength }, (_, index) =>
    nodeSeries.map((series) => series[index]).filter((sample): sample is NodeMetricSample => Boolean(sample)),
  );

  const performanceSeries = alignedSamples.map((samples) => {
    const cpu = samples.length > 0 ? samples.reduce((sum, s) => sum + s.cpu, 0) / samples.length : 0;
    const ram = samples.length > 0 ? samples.reduce((sum, s) => sum + s.ram, 0) / samples.length : 0;
    return { label: samples[0] ? formatTime(samples[0].createdAt) : '', cpu, ram };
  });

  const networkSeries = alignedSamples.map((samples) => {
    const rx = samples.length > 0 ? samples.reduce((sum, s) => sum + s.networkRx, 0) / samples.length : 0;
    const tx = samples.length > 0 ? samples.reduce((sum, s) => sum + s.networkTx, 0) / samples.length : 0;
    return {
      label: samples[0] ? formatTime(samples[0].createdAt) : '',
      rx: (rx * 8) / 1_000_000,
      tx: (tx * 8) / 1_000_000,
    };
  });

  const storageSlices = activities
    .filter((node) => node.storage.totalUsedGb > 0)
    .map((node) => ({ name: node.name, value: node.storage.totalUsedGb }));

  return (
    <DashboardLayout>
      <div className="space-y-10">
        <PageHeader
          icon={LayoutDashboard}
          title="Vue d'ensemble"
          description="État en direct de votre flotte de nœuds : capacité, charge, alertes et travaux en cours."
        />

        <Callout>
          Les débits réseau sont affichés en <strong className="text-violet-100">MB/s</strong>, les tendances CPU/RAM
          sur une échelle de 0 à 100 %.
        </Callout>

        <section className="space-y-4">
          <SectionLabel>Aperçu</SectionLabel>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
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
              value={alerts.length}
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
        </section>

        <section className="space-y-4">
          <SectionLabel>Performance</SectionLabel>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card className="border-white/[0.08] bg-zinc-900/65">
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
            <Card className="border-white/[0.08] bg-zinc-900/65">
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
        </section>

        <section className="space-y-4">
          <SectionLabel>Stockage &amp; alertes</SectionLabel>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card className="border-white/[0.08] bg-zinc-900/65">
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

            <Card className="border-white/[0.08] bg-zinc-900/65">
              <CardHeader>
                <CardTitle className="text-base">Alertes récentes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {alerts.slice(0, 5).map((alert) => (
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
                {alerts.length === 0 && (
                  <div className="flex items-center justify-center gap-2 py-4 text-sm text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    Aucune alerte active
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="space-y-4">
          <SectionLabel>Serveurs actifs</SectionLabel>
          <Card className="border-white/[0.08] bg-zinc-900/65">
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {spotlightNodes.map((node) => (
                  <ServerTrendCard
                    key={node.id}
                    node={node}
                    samples={samplesByNode[node.id] ?? []}
                    labels={nodeLabels[node.id] ?? []}
                  />
                ))}
                {spotlightNodes.length === 0 && (
                  <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
                    Aucun serveur n’a encore remonté d’activité.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <SectionLabel>Activité</SectionLabel>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card className="border-white/[0.08] bg-zinc-900/65">
              <CardHeader>
                <CardTitle className="text-base">Travaux de synchronisation</CardTitle>
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

            <Card className="border-white/[0.08] bg-zinc-900/65">
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
        </section>
      </div>
    </DashboardLayout>
  );
}
