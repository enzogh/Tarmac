'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Copy, Crown, Globe, KeyRound, Plus, RefreshCcw, ShieldCheck, Trash2 } from 'lucide-react';
import { Cell, Pie, PieChart } from 'recharts';
import { api, DnsRecordItem, DnsServerGroupItem, DnsZoneItem, NodeItem } from '@/lib/api';
import { SectionLabel } from '@/components/SectionLabel';
import { Badge } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CardListSkeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { JournalLogPanel } from './JournalLogPanel';
import { RecordsTable } from './RecordsTable';
import { StatusIndicator } from './StatusIndicator';
import { useCollapsibleCards } from './useCollapsibleCards';
import { DnsJournalState, DnsNotice } from './useDnsPageState';

const RECORD_TYPE_COLORS = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'] as const;

// Same donut pattern as StorageBreakdownChart (dashboard-charts.tsx) but
// generic over units - that component hardcodes a "GB" suffix which doesn't
// fit a record count.
function RecordTypeChart({ data }: { data: { name: string; value: number }[] }) {
  const config: ChartConfig = Object.fromEntries(
    data.map((slice, index) => [
      slice.name,
      { label: slice.name, color: `hsl(var(--${RECORD_TYPE_COLORS[index % RECORD_TYPE_COLORS.length]}))` },
    ]),
  );

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <ChartContainer config={config} className="h-40 w-full sm:w-40">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent valueFormatter={(v) => `${v} enregistrement${v > 1 ? 's' : ''}`} />} />
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={40} outerRadius={60} paddingAngle={2}>
            {data.map((slice, index) => (
              <Cell key={slice.name} fill={`hsl(var(--${RECORD_TYPE_COLORS[index % RECORD_TYPE_COLORS.length]}))`} stroke="none" />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="flex-1 space-y-1.5">
        {data.map((slice, index) => (
          <div key={slice.name} className="flex items-center justify-between gap-3 text-xs">
            <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: `hsl(var(--${RECORD_TYPE_COLORS[index % RECORD_TYPE_COLORS.length]}))` }}
              />
              <span className="font-mono">{slice.name}</span>
            </span>
            <span className="shrink-0 font-mono text-foreground/90">{slice.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ZonesSection({
  zones,
  zonesLoading,
  groups,
  nodes,
  busyKey,
  setBusyKey,
  setNotice,
  refreshZones,
  journal,
  onOpenRecordDialog,
  onOpenDelegation,
  onOpenDnssec,
}: {
  zones: DnsZoneItem[];
  zonesLoading: boolean;
  groups: DnsServerGroupItem[];
  nodes: NodeItem[];
  busyKey: string | null;
  setBusyKey: (key: string | null) => void;
  setNotice: (notice: DnsNotice) => void;
  refreshZones: () => Promise<unknown>;
  journal: DnsJournalState;
  onOpenRecordDialog: (zoneId: string, record?: DnsRecordItem) => void;
  onOpenDelegation: (zone: DnsZoneItem) => void;
  onOpenDnssec: (zone: DnsZoneItem) => void;
}) {
  const nodeName = (nodeId: string) => nodes.find((n) => n.id === nodeId)?.name ?? nodeId;
  const cards = useCollapsibleCards(zones, (zone) => zone.status !== 'active' || zone.records.length === 0);

  const recordsByType = new Map<string, number>();
  for (const zone of zones) {
    for (const record of zone.records) {
      recordsByType.set(record.type, (recordsByType.get(record.type) ?? 0) + 1);
    }
  }
  const recordTypeBreakdown = [...recordsByType.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }));

  const deleteZone = async (zone: DnsZoneItem) => {
    if (!window.confirm(`Supprimer la zone « ${zone.name} » et tous ses enregistrements ?`)) return;
    setBusyKey(`zone-${zone.id}`);
    try {
      await api.dns.zones.delete(zone.id);
      await refreshZones();
    } catch {
      setNotice({ type: 'error', message: 'Erreur lors de la suppression de la zone.' });
    } finally {
      setBusyKey(null);
    }
  };

  const reapplyZone = async (zone: DnsZoneItem) => {
    setBusyKey(`zone-reapply-${zone.id}`);
    try {
      await api.dns.zones.reapply(zone.id);
      setNotice({ type: 'success', message: `Ré-application de « ${zone.name} » programmée.` });
      await refreshZones();
    } catch {
      setNotice({ type: 'error', message: 'Erreur lors de la relance de la zone.' });
    } finally {
      setBusyKey(null);
    }
  };

  const deleteRecord = async (zoneId: string, recordId: string) => {
    setBusyKey(`record-${recordId}`);
    try {
      await api.dns.zones.deleteRecord(zoneId, recordId);
      await refreshZones();
    } catch {
      setNotice({ type: 'error', message: "Erreur lors de la suppression de l'enregistrement." });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section className="space-y-4">
      <SectionLabel>Zones</SectionLabel>
      {!zonesLoading && recordTypeBreakdown.length > 0 && (
        <Card className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-zinc-300">Répartition des enregistrements par type</CardTitle>
          </CardHeader>
          <CardContent>
            <RecordTypeChart data={recordTypeBreakdown} />
          </CardContent>
        </Card>
      )}
      {zonesLoading ? (
        <CardListSkeleton cards={2} />
      ) : zones.length === 0 ? (
        <Card className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
          <CardContent className="pt-12 pb-12 text-center">
            <Globe className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
            <p className="font-medium text-muted-foreground">Aucune zone créée</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {groups.length === 0
                ? "Crée d'abord un groupe DNS, puis une zone."
                : 'Cliquez sur « Nouvelle zone » pour ajouter un domaine.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 animate-fade-in">
          {zones.map((zone) => {
            const group = groups.find((g) => g.id === zone.groupId);
            const key = `zone:${zone.id}`;
            const collapsed = cards.isCollapsed(zone.id);
            return (
              <Card key={zone.id} className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => cards.toggle(zone.id)}
                      className="flex items-center gap-2 text-left"
                    >
                      <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${collapsed ? '-rotate-90' : ''}`} />
                      <CardTitle className="flex items-center gap-2">
                        <Globe className="w-5 h-5 text-violet-400" />
                        {zone.name}
                      </CardTitle>
                    </button>
                    <div className="flex flex-wrap items-center gap-2">
                      {group && <Badge label={group.name} type="info" />}
                      <StatusIndicator status={zone.status} />
                      {group?.members.map((member) => {
                        const memberKey = `${key}:${member.nodeId}`;
                        const isPrimary = member.role === 'primary';
                        return (
                          <Tooltip key={member.nodeId}>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className={journal.expandedLogKey === memberKey ? 'text-violet-400' : ''}
                                onClick={() => journal.toggleLogs(memberKey, member.nodeId)}
                              >
                                {isPrimary ? <Crown className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              Journal — {nodeName(member.nodeId)} ({isPrimary ? 'primaire' : 'secondaire'})
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={busyKey === `zone-reapply-${zone.id}`}
                            onClick={() => reapplyZone(zone)}
                          >
                            <RefreshCcw className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Force une ré-application complète au prochain cycle de réconciliation (~15s)</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" onClick={() => onOpenDelegation(zone)}>
                            <KeyRound
                              className={`h-3.5 w-3.5 transition-colors duration-500 ${
                                zone.delegationVerified
                                  ? 'text-emerald-400'
                                  : zone.delegationCheckedAt
                                    ? 'animate-pulse text-amber-300'
                                    : ''
                              }`}
                            />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {zone.delegationVerified
                            ? 'Délégation vérifiée sur le DNS public'
                            : zone.delegationCheckedAt
                              ? 'Délégation en attente de propagation'
                              : 'Délégation — vérification en cours'}
                        </TooltipContent>
                      </Tooltip>
                      {zone.dnssecEnabled && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" onClick={() => onOpenDnssec(zone)}>
                              <ShieldCheck className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>DNSSEC</TooltipContent>
                        </Tooltip>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={busyKey === `zone-${zone.id}`}
                            onClick={() => deleteZone(zone)}
                            className="text-rose-300 hover:text-rose-200"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Supprimer la zone</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                  {group?.members.map((member) => (
                    <JournalLogPanel key={member.nodeId} journal={journal} panelKey={`${key}:${member.nodeId}`} nodeId={member.nodeId} />
                  ))}
                </CardHeader>
                <AnimatePresence initial={false}>
                  {!collapsed && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <CardContent className="space-y-2">
                        {zone.records.length === 0 ? (
                          <p className="text-sm text-muted-foreground">Aucun enregistrement pour cette zone.</p>
                        ) : (
                          <RecordsTable
                            zoneId={zone.id}
                            records={zone.records}
                            busyKey={busyKey}
                            onEdit={(record) => onOpenRecordDialog(zone.id, record)}
                            onDelete={deleteRecord}
                          />
                        )}
                        <Button variant="secondary" size="sm" className="gap-1" onClick={() => onOpenRecordDialog(zone.id)}>
                          <Plus className="h-3.5 w-3.5" />
                          Ajouter un enregistrement
                        </Button>
                      </CardContent>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
