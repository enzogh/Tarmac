'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, Forecast, NodeItem, AlertItem, SyncJobItem, MigrationItem } from '../../lib/api';
import { DashboardLayout } from '../../components/DashboardLayout';
import { Card, StatCard, Badge } from '../../components/ui';

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
      <div>
        <h1 className="text-3xl font-bold mb-8 text-slate-100">Vue d'ensemble du système</h1>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="Utilisation du stockage"
            value={forecast ? `${Math.round(forecast.usageRatio * 100)}%` : '-'}
            icon="💾"
            change={forecast ? `${forecast.avgGrowthPerDayGb} GB/jour` : undefined}
          />
          <StatCard
            label="Nœuds en ligne"
            value={`${nodesOnline}/${nodes.length}`}
            icon="🖥️"
            changeType="up"
          />
          <StatCard
            label="Alertes actives"
            value={alerts.length}
            icon="⚠️"
            change={alertsCritical > 0 ? `${alertsCritical} critiques` : `${alertsWarning} avertissements`}
            changeType={alertsCritical > 0 ? 'down' : alertsWarning > 0 ? 'neutral' : 'up'}
          />
          <StatCard
            label="Migrations en cours"
            value={migrationsActive}
            icon="➡️"
            changeType="neutral"
          />
        </div>

        {/* Storage forecast */}
        {forecast && (
          <Card title="📊 Prévision d'utilisation du stockage" className="mb-8">
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-slate-300">{forecast.totalUsedGb} GB utilisés</span>
                  <span className="text-slate-400">{forecast.totalCapacityGb} GB total</span>
                </div>
                <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-blue-600 to-blue-400 h-full transition-all"
                    style={{ width: `${forecast.usageRatio * 100}%` }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-slate-400">Croissance moyenne</p>
                  <p className="text-lg font-semibold text-slate-100">{forecast.avgGrowthPerDayGb} GB/jour</p>
                </div>
                <div>
                  <p className="text-slate-400">Jours restants</p>
                  <p className="text-lg font-semibold text-slate-100">
                    {forecast.forecast.daysToFull ?? 'N/A'} jours
                  </p>
                </div>
              </div>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Nodes Status */}
          <Card title="🖥️ État des nœuds">
            <div className="space-y-2">
              {nodes.slice(0, 5).map((node) => (
                <div key={node.id} className="flex items-center justify-between p-3 bg-slate-800 rounded">
                  <div>
                    <p className="font-medium text-slate-100">{node.name}</p>
                    <p className="text-xs text-slate-400">{node.role}</p>
                  </div>
                  <Badge
                    label={node.status}
                    type={node.status === 'online' ? 'success' : 'error'}
                  />
                </div>
              ))}
              {nodes.length > 5 && (
                <p className="text-sm text-slate-400 text-center pt-2">
                  +{nodes.length - 5} nœuds supplémentaires
                </p>
              )}
            </div>
          </Card>

          {/* Recent alerts */}
          <Card title="⚠️ Alertes récentes">
            <div className="space-y-2">
              {alerts.slice(0, 5).map((alert) => (
                <div key={alert.id} className="flex items-start gap-3 p-3 bg-slate-800 rounded">
                  <div className="flex-1">
                    <p className="font-medium text-slate-100 text-sm">{alert.message}</p>
                    <p className="text-xs text-slate-400 mt-1">{alert.status}</p>
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
                <p className="text-center text-slate-400 py-4">✅ Aucune alerte</p>
              )}
            </div>
          </Card>
        </div>

        {/* Sync jobs and migrations */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-8">
          <Card title="🔄 Travaux de synchronisation">
            <div className="space-y-2">
              {syncJobs.slice(0, 5).map((job) => (
                <div key={job.id} className="flex items-center justify-between p-3 bg-slate-800 rounded">
                  <div>
                    <p className="font-medium text-slate-100">{job.name}</p>
                    <p className="text-xs text-slate-400">{job.sourcePath}</p>
                  </div>
                  <Badge label={job.status} type="info" />
                </div>
              ))}
              {syncJobs.length === 0 && (
                <p className="text-center text-slate-400 py-4">Aucun travail</p>
              )}
            </div>
          </Card>

          <Card title="➡️ Migrations en cours">
            <div className="space-y-3">
              {migrations.slice(0, 5).map((migration) => (
                <div key={migration.id} className="p-3 bg-slate-800 rounded">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-medium text-slate-100">{migration.name}</p>
                    <span className="text-sm text-slate-400">{migration.progress}%</span>
                  </div>
                  <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-green-600 to-green-400 h-full transition-all"
                      style={{ width: `${migration.progress}%` }}
                    />
                  </div>
                </div>
              ))}
              {migrations.length === 0 && (
                <p className="text-center text-slate-400 py-4">Aucune migration</p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
