'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Eye, CheckCircle2, Info, AlertCircle, AlertTriangle, Circle, Trash2 } from 'lucide-react';
import { api, AlertItem } from '../../../lib/api';
import { DashboardLayout } from '../../../components/DashboardLayout';
import { Badge } from '../../../components/ui';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../components/ui/tooltip';
import { Label } from '../../../components/ui/label';

type SeverityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low';
type StatusFilter = 'all' | 'open' | 'acknowledged' | 'resolved';

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

  const handleDelete = async (alertId: string) => {
    if (!token) return;
    await api.alerts.remove(token, alertId);
    await load();
  };

  const getSeverityColor = (severity: string): 'success' | 'warning' | 'error' | 'info' => {
    switch (severity) {
      case 'critical': return 'error';
      case 'high': return 'warning';
      default: return 'info';
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical': return <AlertCircle className="h-5 w-5 text-rose-400" />;
      case 'high': return <AlertTriangle className="h-5 w-5 text-amber-400" />;
      case 'medium': return <Circle className="h-5 w-5 text-sky-400" />;
      default: return <Circle className="h-5 w-5 text-zinc-400" />;
    }
  };

  let filtered = alerts;
  if (severityFilter !== 'all') filtered = filtered.filter((a) => a.severity === severityFilter);
  if (statusFilter !== 'all') filtered = filtered.filter((a) => a.status === statusFilter);

  const critical = alerts.filter((a) => a.severity === 'critical' && a.status !== 'resolved').length;
  const warnings = alerts.filter((a) => a.severity === 'high' && a.status !== 'resolved').length;

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Alertes</h1>
          <p className="text-sm text-muted-foreground">Notifications et incidents du système.</p>
        </div>

        {/* Info callout */}
        <div className="flex items-start gap-3 rounded-xl border border-blue-500/20 bg-blue-500/[0.07] px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
          <p className="text-sm text-blue-300/80">
            Les alertes sont générées automatiquement par le système. Utilisez <strong className="text-blue-200">Marquer comme lu</strong> pour indiquer que vous avez vu l'alerte,
            <strong className="text-blue-200"> Résoudre</strong> une fois le problème corrigé, ou <strong className="text-blue-200">Supprimer</strong> pour nettoyer l’historique.
          </p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.07] p-4">
            <p className="text-sm text-rose-300">Critiques actives</p>
            <p className="mt-2 text-3xl font-bold text-rose-400">{critical}</p>
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.07] p-4">
            <p className="text-sm text-amber-300">Avertissements actifs</p>
            <p className="mt-2 text-3xl font-bold text-amber-400">{warnings}</p>
          </div>
          <div className="rounded-xl border border-sky-500/20 bg-sky-500/[0.07] p-4">
            <p className="text-sm text-sky-300">Total</p>
            <p className="mt-2 text-3xl font-bold text-sky-400">{alerts.length}</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-violet-400" />
                <CardTitle>Liste des alertes</CardTitle>
              </div>
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Sévérité</Label>
                  <Select value={severityFilter} onValueChange={(v) => setSeverityFilter(v as SeverityFilter)}>
                    <SelectTrigger className="h-8 w-40 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Toutes</SelectItem>
                      <SelectItem value="critical">Critique</SelectItem>
                      <SelectItem value="high">Grave</SelectItem>
                      <SelectItem value="medium">Moyen</SelectItem>
                      <SelectItem value="low">Faible</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Statut</Label>
                  <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                    <SelectTrigger className="h-8 w-40 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tous</SelectItem>
                      <SelectItem value="open">Ouvert</SelectItem>
                      <SelectItem value="acknowledged">Reconnu</SelectItem>
                      <SelectItem value="resolved">Résolu</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {filtered.map((alert) => (
              <div
                key={alert.id}
                className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.04]"
              >
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 mt-0.5">
                    {getSeverityIcon(alert.severity)}
                  </div>

                  <div className="flex-1">
                    <div className="flex items-start justify-between gap-4 mb-2">
                      <div>
                        <p className="font-semibold text-foreground">{alert.message}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {new Date(alert.triggeredAt).toLocaleString('fr-FR')}
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

                    <div className="flex flex-wrap gap-2">
                      {alert.status === 'open' && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleAck(alert.id)}
                            >
                              <Eye className="h-3.5 w-3.5" />
                              Marquer comme lu
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Marquer comme vu — le problème est en cours de traitement</TooltipContent>
                        </Tooltip>
                      )}
                      {alert.status !== 'resolved' && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleResolve(alert.id)}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Résoudre
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Marquer l'alerte comme résolue — le problème est corrigé</TooltipContent>
                        </Tooltip>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(alert.id)}
                            className="text-rose-300 hover:text-rose-200"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Supprimer
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Supprimer définitivement cette alerte</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                <span>{alerts.length === 0 ? 'Aucune alerte' : 'Aucune alerte correspondant aux filtres'}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
