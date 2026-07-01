'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, AlertItem } from '../../../lib/api';
import { DashboardLayout } from '../../../components/DashboardLayout';
import { Card, Badge } from '../../../components/ui';

type SeverityFilter = 'all' | 'critical' | 'warning' | 'info';
type StatusFilter = 'all' | 'new' | 'acknowledged' | 'resolved';

export default function AlertsPage() {
  const router = useRouter();
  const token = useMemo(() => (typeof window !== 'undefined' ? localStorage.getItem('tarmac_token') : null), []);

  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const load = async () => {
    if (!token) return;
    try {
      const a = await api.alerts.list(token);
      setAlerts(a);
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

  const handleAck = async (alertId: string) => {
    if (!token) return;
    await api.alerts.ack(token, alertId);
    await load();
  };

  const handleResolve = async (alertId: string) => {
    if (!token) return;
    await api.alerts.resolve(token, alertId);
    await load();
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'error';
      case 'warning':
        return 'warning';
      case 'info':
        return 'info';
      default:
        return 'info';
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return '🔴';
      case 'warning':
        return '🟡';
      case 'info':
        return '🔵';
      default:
        return '⚪';
    }
  };

  // Filter alerts
  let filtered = alerts;

  if (severityFilter !== 'all') {
    filtered = filtered.filter((a) => a.severity === severityFilter);
  }

  if (statusFilter !== 'all') {
    filtered = filtered.filter((a) => a.status === statusFilter);
  }

  const critical = alerts.filter((a) => a.severity === 'critical' && a.status !== 'resolved').length;
  const warnings = alerts.filter((a) => a.severity === 'high' && a.status !== 'resolved').length;

  return (
    <DashboardLayout>
      <div>
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-slate-100">⚠️ Alertes</h1>
          <p className="text-slate-400">Notifications du système</p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="p-4 bg-red-900/20 border border-red-800 rounded-lg">
            <p className="text-sm text-red-300">Critiques</p>
            <p className="text-3xl font-bold text-red-400 mt-2">{critical}</p>
          </div>
          <div className="p-4 bg-amber-900/20 border border-amber-800 rounded-lg">
            <p className="text-sm text-amber-300">Avertissements</p>
            <p className="text-3xl font-bold text-amber-400 mt-2">{warnings}</p>
          </div>
          <div className="p-4 bg-blue-900/20 border border-blue-800 rounded-lg">
            <p className="text-sm text-blue-300">Total</p>
            <p className="text-3xl font-bold text-blue-400 mt-2">{alerts.length}</p>
          </div>
        </div>

        <Card title="Liste des alertes">
          {/* Filters */}
          <div className="mb-6 flex gap-4 flex-wrap">
            <div>
              <label className="block text-sm font-medium mb-2">Sévérité</label>
              <select
                className="select"
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value as SeverityFilter)}
              >
                <option value="all">Tous</option>
                <option value="critical">🔴 Critique</option>
                <option value="high">🟠 Grave</option>
                <option value="medium">🟡 Moyen</option>
                <option value="low">🔵 Faible</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Statut</label>
              <select
                className="select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              >
                <option value="all">Tous</option>
                <option value="open">Ouvert</option>
                <option value="acknowledged">Reconnu</option>
                <option value="resolved">Résolu</option>
              </select>
            </div>
          </div>

          {/* Alerts list */}
          <div className="space-y-3">
            {filtered.map((alert) => (
              <div
                key={alert.id}
                className="p-4 bg-slate-800 rounded-lg border border-slate-700 hover:border-slate-600 transition-colors"
              >
                <div className="flex items-start gap-4">
                  <div className="text-2xl flex-shrink-0">
                    {getSeverityIcon(alert.severity)}
                  </div>

                  <div className="flex-1">
                    <div className="flex items-start justify-between gap-4 mb-2">
                      <div>
                        <p className="font-semibold text-slate-100">{alert.message}</p>
                        <p className="text-xs text-slate-400 mt-1">
                          {new Date((alert as any).createdAt).toLocaleString('fr-FR')}
                        </p>
                      </div>
                      <Badge
                        label={alert.severity}
                        type={getSeverityColor(alert.severity)}
                      />
                    </div>

                    <div className="flex items-center gap-2 mb-3">
                      <Badge
                        label={alert.status}
                        type={alert.status === 'resolved' ? 'success' : 'info'}
                      />
                    </div>

                      {alert.status === 'open' && (
                        <button
                          onClick={() => handleAck(alert.id)}
                          className="btn-secondary text-sm"
                        >
                          👁️ Reconnaître
                        </button>
                      )}
                      {alert.status !== 'resolved' && (
                        <button
                          onClick={() => handleResolve(alert.id)}
                          className="btn-secondary text-sm"
                        >
                          ✅ Résoudre
                        </button>
                      )}
                  </div>
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="text-center text-slate-400 py-8">
                {alerts.length === 0 ? '✅ Aucune alerte' : 'Aucune alerte correspondant aux filtres'}
              </p>
            )}
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
