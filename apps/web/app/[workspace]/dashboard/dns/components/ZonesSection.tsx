'use client';

import { Globe, KeyRound, Plus, RefreshCcw, ScrollText, ShieldCheck, Trash2 } from 'lucide-react';
import { api, DnsRecordItem, DnsServerGroupItem, DnsZoneItem } from '@/lib/api';
import { SectionLabel } from '@/components/SectionLabel';
import { Badge } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CardListSkeleton } from '@/components/ui/skeleton';
import { JournalLogPanel } from './JournalLogPanel';
import { StatusIndicator } from './StatusIndicator';
import { DnsJournalState, DnsNotice } from './useDnsPageState';

export function ZonesSection({
  zones,
  zonesLoading,
  groups,
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
  busyKey: string | null;
  setBusyKey: (key: string | null) => void;
  setNotice: (notice: DnsNotice) => void;
  refreshZones: () => Promise<unknown>;
  journal: DnsJournalState;
  onOpenRecordDialog: (zoneId: string, record?: DnsRecordItem) => void;
  onOpenDelegation: (zone: DnsZoneItem) => void;
  onOpenDnssec: (zone: DnsZoneItem) => void;
}) {
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
            const primaryNodeId = group?.members.find((m) => m.role === 'primary')?.nodeId;
            const key = `zone:${zone.id}`;
            return (
              <Card key={zone.id} className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2">
                      <Globe className="w-5 h-5 text-violet-400" />
                      {zone.name}
                    </CardTitle>
                    <div className="flex flex-wrap items-center gap-2">
                      {group && <Badge label={group.name} type="info" />}
                      {zone.dnssecEnabled && <Badge label="DNSSEC" type="success" />}
                      <StatusIndicator status={zone.status} />
                      {primaryNodeId && (
                        <Button variant="ghost" size="sm" className="gap-1" onClick={() => journal.toggleLogs(key, primaryNodeId)}>
                          <ScrollText className="h-3.5 w-3.5" />
                          {journal.expandedLogKey === key ? 'Masquer' : 'Journal'}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1"
                        disabled={busyKey === `zone-reapply-${zone.id}`}
                        onClick={() => reapplyZone(zone)}
                        title="Force une ré-application complète de la zone au prochain cycle de réconciliation (~15s)"
                      >
                        <RefreshCcw className="h-3.5 w-3.5" />
                        Réappliquer
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => onOpenDelegation(zone)} className="gap-1">
                        <KeyRound className="h-3.5 w-3.5" />
                        Délégation
                      </Button>
                      {zone.dnssecEnabled && (
                        <Button variant="ghost" size="sm" onClick={() => onOpenDnssec(zone)} className="gap-1">
                          <ShieldCheck className="h-3.5 w-3.5" />
                          DNSSEC
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busyKey === `zone-${zone.id}`}
                        onClick={() => deleteZone(zone)}
                        className="text-rose-300 hover:text-rose-200"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {primaryNodeId && <JournalLogPanel journal={journal} panelKey={key} nodeId={primaryNodeId} />}
                </CardHeader>
                <CardContent className="space-y-2">
                  {zone.records.length === 0 && (
                    <p className="text-sm text-muted-foreground">Aucun enregistrement pour cette zone.</p>
                  )}
                  {zone.records.map((record) => (
                    <div
                      key={record.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono">{record.name}</span>
                        <Badge label={record.type} type="info" />
                        {record.isGeo && <Badge label="Géo-routage" type="success" />}
                        <span className="text-xs text-muted-foreground">TTL {record.ttl}s</span>
                        <span className="text-xs text-muted-foreground">
                          {record.values.map((v) => v.content).join(', ')}
                        </span>
                      </span>
                      <div className="flex items-center gap-2">
                        <StatusIndicator status={record.status} />
                        <Button variant="ghost" size="sm" onClick={() => onOpenRecordDialog(zone.id, record)}>
                          Modifier
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busyKey === `record-${record.id}`}
                          onClick={() => deleteRecord(zone.id, record.id)}
                          className="text-rose-300 hover:text-rose-200"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  <Button variant="secondary" size="sm" className="gap-1" onClick={() => onOpenRecordDialog(zone.id)}>
                    <Plus className="h-3.5 w-3.5" />
                    Ajouter un enregistrement
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
