'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUpToLine,
  Bell,
  CheckCircle2,
  Cpu,
  HardDrive,
  LayoutDashboard,
  Radar,
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
import { StatCard, Badge } from '../../components/ui';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Progress } from '../../components/ui/progress';

const formatMbps = (value: number) => `${((value * 8) / 1_000_000).toFixed(2)} MB/s`;

export default function OverviewPage() {
  const router = useRouter();
  const token = useMemo(() => (typeof window !== 'undefined' ? localStorage.getItem('tarmac_token') : null), []);

  const [activities, setActivities] = useState<NodeActivityItem[]>([]);
  const [samplesByNode, setSamplesByNode] = useState<Record<string, NodeMetricSample[]>>({});
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [syncJobs, setSyncJobs] = useState<SyncJobItem[]>([]);
  const [migrations, setMigrations] = useState<MigrationItem[]>([]);

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
  const averageCpu =
    activities.length > 0 ? activities.reduce((acc, node) => acc + node.metrics.cpu, 0) / activities.length : 0;
  const averageRam =
    activities.length > 0 ? activities.reduce((acc, node) => acc + node.metrics.ram, 0) / activities.length : 0;
  const totalNetworkRx = activities.reduce((acc, node) => acc + node.metrics.networkRx, 0);
  const totalNetworkTx = activities.reduce((acc, node) => acc + node.metrics.networkTx, 0);
  const spotlightNodes = [...activities].sort((left, right) => right.metrics.cpu - left.metrics.cpu).slice(0, 4);

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <PageHeader
          icon={LayoutDashboard}
          title="Vue d'ensemble"
          description="État en direct de votre flotte de nœuds : capacité, charge, alertes et travaux en cours."
        />

        <Callout>
          Les débits réseau sont affichés en <strong className="text-violet-100">MB/s</strong>, les tendances CPU/RAM
          sur une échelle de 0 à 100 %.
        </Callout>

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

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="CPU moyen"
            value={`${Math.round(averageCpu)}%`}
            icon={<Cpu className="h-8 w-8" />}
            change={`${activities.length} serveur${activities.length > 1 ? 's' : ''}`}
            changeType="neutral"
          />
          <StatCard
            label="RAM moyenne"
            value={`${Math.round(averageRam)}%`}
            icon={<Radar className="h-8 w-8" />}
            changeType="neutral"
          />
          <StatCard
            label="Débit descendant"
            value={formatMbps(totalNetworkRx)}
            icon={<ArrowDownToLine className="h-8 w-8" />}
            changeType="neutral"
          />
          <StatCard
            label="Débit montant"
            value={formatMbps(totalNetworkTx)}
            icon={<ArrowUpToLine className="h-8 w-8" />}
            changeType="neutral"
          />
        </div>

        <Card className="border-white/[0.08] bg-zinc-900/65">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-violet-400" />
              <CardTitle>Serveurs les plus actifs</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {spotlightNodes.map((node) => (
                <ServerTrendCard key={node.id} node={node} samples={samplesByNode[node.id] ?? []} />
              ))}
              {spotlightNodes.length === 0 && (
                <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
                  Aucun serveur n’a encore remonté d’activité.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card className="border-white/[0.08] bg-zinc-900/65">
            <CardHeader>
              <CardTitle>Alertes récentes</CardTitle>
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

          <Card className="border-white/[0.08] bg-zinc-900/65">
            <CardHeader>
              <CardTitle>Travaux de synchronisation</CardTitle>
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
        </div>

        <Card className="border-white/[0.08] bg-zinc-900/65">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-violet-400" />
              <CardTitle>Migrations en cours</CardTitle>
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
    </DashboardLayout>
  );
}
