'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { HardDrive, Server, Bell, ArrowRightLeft, CheckCircle2, TrendingUp, Info } from 'lucide-react';
import { api, Forecast, NodeItem, AlertItem, SyncJobItem, MigrationItem } from '../../lib/api';
import { DashboardLayout } from '../../components/DashboardLayout';
import { StatCard, Badge } from '../../components/ui';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Progress } from '../../components/ui/progress';

export default function OverviewPage() {
  const router = useRouter();
  const token = useMemo(() => (typeof window !== 'undefined' ? localStorage.getItem('tarmac_token') : null), []);

  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [syncJobs, setSyncJobs] = useState<SyncJobItem[]>([]);
  const [migrations, setMigrations] = useState<MigrationItem[]>([]);

  const load = async () => {
    if (!token) return;
    try {
      const [n, a, sj, mg, fc] = await Promise.all([
        api.nodes.list(token),
        api.alerts.list(token),
        api.syncJobs.list(token),
        api.migrations.list(token),
        api.storage.forecast(token),
      ]);
      setNodes(n);
      setAlerts(a);
      setSyncJobs(sj);
      setMigrations(mg);
      setForecast(fc);
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

  const alertsCritical = alerts.filter((a) => a.severity === 'critical').length;
  const alertsWarning = alerts.filter((a) => a.severity === 'high').length;
  const nodesOnline = nodes.filter((n) => n.status === 'online').length;
  const migrationsActive = migrations.filter((m) => m.status === 'running').length;

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Vue d'ensemble</h1>
          <p className="text-sm text-muted-foreground">
            Suivi en temps réel de l'état du stockage, des nœuds, des alertes et des migrations.
          </p>
        </div>

        {/* Info callout */}
        <div className="flex items-start gap-3 rounded-xl border border-violet-500/20 bg-violet-500/[0.07] px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
          <p className="text-sm text-violet-300/80">
            Ce tableau de bord se rafraîchit automatiquement toutes les 5 secondes.
            Les données reflètent l'état actuel du cluster en temps réel.
          </p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Utilisation du stockage"
            value={forecast ? `${Math.round(forecast.usageRatio * 100)}%` : '-'}
            icon={<HardDrive className="h-8 w-8" />}
            change={forecast ? `${forecast.avgGrowthPerDayGb} GB/jour` : undefined}
          />
          <StatCard
            label="Nœuds en ligne"
            value={`${nodesOnline}/${nodes.length}`}
            icon={<Server className="h-8 w-8" />}
            changeType="up"
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

        {/* Storage forecast */}
        {forecast && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-violet-400" />
                <CardTitle>Prévision d'utilisation du stockage</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                  <span className="text-foreground">{forecast.totalUsedGb} GB utilisés</span>
                  <span className="text-muted-foreground">{forecast.totalCapacityGb} GB total</span>
                </div>
                <Progress value={forecast.usageRatio * 100} className="h-2.5" />
              </div>
              <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-muted-foreground">Croissance moyenne</p>
                  <p className="text-lg font-semibold text-foreground">{forecast.avgGrowthPerDayGb} GB/jour</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Jours restants</p>
                  <p className="text-lg font-semibold text-foreground">
                    {forecast.forecast.daysToFull ?? 'N/A'} jours
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Nodes Status */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Server className="h-5 w-5 text-violet-400" />
                <CardTitle>État des nœuds</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {nodes.slice(0, 5).map((node) => (
                <div
                  key={node.id}
                  className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 transition-colors hover:bg-white/[0.04]"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">{node.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{node.role}</p>
                  </div>
                  <Badge
                    label={node.status}
                    type={node.status === 'online' ? 'success' : 'error'}
                  />
                </div>
              ))}
              {nodes.length > 5 && (
                <p className="pt-1 text-center text-xs text-muted-foreground">
                  +{nodes.length - 5} nœuds supplémentaires
                </p>
              )}
              {nodes.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">Aucun nœud</p>
              )}
            </CardContent>
          </Card>

          {/* Recent alerts */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-violet-400" />
                <CardTitle>Alertes récentes</CardTitle>
              </div>
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
                    type={
                      alert.severity === 'critical'
                        ? 'error'
                        : alert.severity === 'high'
                          ? 'warning'
                          : 'info'
                    }
                  />
                </div>
              ))}
              {alerts.length === 0 && (
                <div className="flex items-center gap-2 py-4 justify-center text-sm text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  Aucune alerte active
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sync jobs and migrations */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
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
              {syncJobs.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">Aucun travail</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="h-5 w-5 text-violet-400" />
                <CardTitle>Migrations en cours</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {migrations.slice(0, 5).map((migration) => (
                <div key={migration.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-medium text-foreground">{migration.name}</p>
                    <span className="text-xs text-muted-foreground">{migration.progress}%</span>
                  </div>
                  <Progress value={migration.progress} className="h-1.5 bg-emerald-500/20 [&>div]:from-emerald-500 [&>div]:to-emerald-300" />
                </div>
              ))}
              {migrations.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">Aucune migration</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
