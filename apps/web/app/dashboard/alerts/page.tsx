'use client';

import { useState } from 'react';
import { Bell, Eye, CheckCircle2, AlertCircle, AlertTriangle, Circle, Trash2 } from 'lucide-react';
import { api } from '../../../lib/api';
import { usePolling } from '../../../lib/hooks/usePolling';
import { DashboardLayout } from '../../../components/DashboardLayout';
import { PageHeader } from '../../../components/PageHeader';
import { Callout } from '../../../components/Callout';
import { Badge, StatCard } from '../../../components/ui';
import { SectionLabel } from '../../../components/SectionLabel';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../components/ui/tooltip';
import { Label } from '../../../components/ui/label';
import { ListSkeleton, StatCardSkeleton } from '../../../components/ui/skeleton';

type SeverityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low';
type StatusFilter = 'all' | 'open' | 'acknowledged' | 'resolved';

export default function AlertsPage() {
  const { data: alerts = [], mutate, isLoading } = usePolling('alerts', api.alerts.list);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const handleAck = async (alertId: string) => {
    await api.alerts.ack(alertId);
    await mutate();
  };

  const handleResolve = async (alertId: string) => {
    await api.alerts.resolve(alertId);
    await mutate();
  };

  const handleDelete = async (alertId: string) => {
    await api.alerts.remove(alertId);
    await mutate();
  };

  const getSeverityColor = (severity: string): 'success' | 'warning' | 'error' | 'info' => {
    switch (severity) {
      case 'critical': return 'error';
      case 'high': return 'warning';
      default: return 'info';
    }
  };

  const getSeverityLabel = (severity: string): string => {
    switch (severity) {
      case 'critical': return 'Critique';
      case 'high': return 'Grave';
      case 'medium': return 'Moyen';
      default: return 'Faible';
    }
  };

  const getStatusLabel = (status: string): string => {
    switch (status) {
      case 'resolved': return 'Résolu';
      case 'acknowledged': return 'Reconnu';
      default: return 'Ouvert';
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
        <PageHeader
          icon={Bell}
          title="Alertes"
          description="Notifications déclenchées par vos règles de seuil (CPU, RAM, espace disque…)."
        />

        <Callout>
          Marquez une alerte comme lue pour indiquer que vous l'avez vue, résolvez-la une fois le problème corrigé,
          ou supprimez-la pour nettoyer l'historique.
        </Callout>

        <section className="space-y-4">
          <SectionLabel>Aperçu</SectionLabel>
          {isLoading ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3 animate-fade-in">
              <StatCard label="Critiques actives" value={critical} icon={<AlertCircle className="h-8 w-8" />} changeType={critical > 0 ? 'down' : 'up'} />
              <StatCard label="Avertissements actifs" value={warnings} icon={<AlertTriangle className="h-8 w-8" />} changeType={warnings > 0 ? 'neutral' : 'up'} />
              <StatCard label="Total" value={alerts.length} icon={<Bell className="h-8 w-8" />} changeType="neutral" />
            </div>
          )}
        </section>

        <SectionLabel>Alertes</SectionLabel>
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
            {isLoading && <ListSkeleton rows={4} />}
            {!isLoading && filtered.map((alert) => (
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
                        label={getSeverityLabel(alert.severity)}
                        type={getSeverityColor(alert.severity)}
                      />
                    </div>

                    <div className="flex items-center gap-2 mb-3">
                      <Badge
                        label={getStatusLabel(alert.status)}
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
            {!isLoading && filtered.length === 0 && (
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
