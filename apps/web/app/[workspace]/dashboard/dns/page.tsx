'use client';

import { useState } from 'react';
import { AlertCircle, CheckCircle2, Globe, Layers, MapPin, Plus, Server, ShieldCheck } from 'lucide-react';
import { api, DnsRecordItem, DnsZoneItem } from '../../../../lib/api';
import { PageHeader } from '../../../../components/PageHeader';
import { SectionLabel } from '../../../../components/SectionLabel';
import { Alert, AlertDescription } from '../../../../components/ui/alert';
import { Button } from '../../../../components/ui/button';
import { StatCard } from '../../../../components/ui';
import { StatCardSkeleton } from '../../../../components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../../components/ui/tabs';
import { DelegationDnssecDialog, DnsInfoPanelState } from './components/DelegationDnssecDialog';
import { GeoMapSection } from './components/GeoMapSection';
import { GroupDialog } from './components/GroupDialog';
import { GroupsSection } from './components/GroupsSection';
import { RecordDialog, RecordDialogTarget } from './components/RecordDialog';
import { useDnsPageState } from './components/useDnsPageState';
import { ZoneDialog } from './components/ZoneDialog';
import { ZonesSection } from './components/ZonesSection';

export default function DnsPage() {
  const {
    nodes,
    groups,
    zones,
    groupsLoading,
    zonesLoading,
    refreshGroups,
    refreshZones,
    notice,
    setNotice,
    busyKey,
    setBusyKey,
    journal,
  } = useDnsPageState();

  // Cross-cutting "which dialog/target is open" state - doesn't belong to
  // any single section below.
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [zoneDialogOpen, setZoneDialogOpen] = useState(false);
  const [recordDialogTarget, setRecordDialogTarget] = useState<RecordDialogTarget | null>(null);
  const [infoPanel, setInfoPanel] = useState<DnsInfoPanelState | null>(null);

  const openRecordDialog = (zoneId: string, record?: DnsRecordItem) => setRecordDialogTarget({ zoneId, record });

  const openDelegation = async (zone: DnsZoneItem) => {
    setInfoPanel({ zone, tab: 'delegation', loading: true });
    try {
      const delegation = await api.dns.zones.getDelegation(zone.id);
      setInfoPanel({ zone, tab: 'delegation', delegation, loading: false });
    } catch {
      setInfoPanel(null);
      setNotice({ type: 'error', message: 'Erreur lors de la récupération de la délégation.' });
    }
  };

  const openDnssec = async (zone: DnsZoneItem) => {
    setInfoPanel({ zone, tab: 'dnssec', loading: true });
    try {
      const dnssec = await api.dns.zones.getDnssecKeys(zone.id);
      setInfoPanel({ zone, tab: 'dnssec', dnssec, loading: false });
    } catch {
      setInfoPanel(null);
      setNotice({ type: 'error', message: 'Erreur lors de la récupération des clés DNSSEC (nœud primaire hors-ligne ?).' });
    }
  };

  const activeGroups = groups.filter((g) => g.status === 'active').length;
  const totalRecords = zones.reduce((sum, zone) => sum + zone.records.length, 0);

  return (
    <>
      <div className="space-y-8">
        {notice && (
          <Alert variant={notice.type === 'error' ? 'destructive' : 'success'}>
            {notice.type === 'error' ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            <AlertDescription>{notice.message}</AlertDescription>
          </Alert>
        )}

        <PageHeader
          icon={Globe}
          title="DNS"
          description="Désignez des serveurs DNS primaire/secondaire dans votre flotte, gérez vos zones et le géo-routage."
          actions={
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => setZoneDialogOpen(true)}
                disabled={groups.length === 0}
                className="gap-2"
              >
                <Plus className="w-4 h-4" />
                Nouvelle zone
              </Button>
              <Button onClick={() => setGroupDialogOpen(true)} className="gap-2 bg-violet-600 text-white hover:bg-violet-500">
                <Plus className="w-5 h-5" />
                Nouveau groupe DNS
              </Button>
            </div>
          }
        />

        <section className="space-y-4">
          <SectionLabel>Aperçu</SectionLabel>
          {groupsLoading ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3 animate-fade-in">
              <StatCard label="Groupes DNS" value={groups.length} icon={<Layers className="h-8 w-8" />} changeType="neutral" />
              <StatCard
                label="Groupes actifs"
                value={activeGroups}
                icon={<ShieldCheck className="h-8 w-8" />}
                changeType={activeGroups === groups.length && groups.length > 0 ? 'up' : 'neutral'}
              />
              <StatCard label="Zones / records" value={`${zones.length} / ${totalRecords}`} icon={<Globe className="h-8 w-8" />} changeType="neutral" />
            </div>
          )}
        </section>

        <Tabs defaultValue="groups" className="space-y-4">
          <TabsList>
            <TabsTrigger value="groups" className="gap-1.5">
              <Server className="h-3.5 w-3.5" />
              Groupes
            </TabsTrigger>
            <TabsTrigger value="zones" className="gap-1.5">
              <Globe className="h-3.5 w-3.5" />
              Zones
            </TabsTrigger>
            <TabsTrigger value="map" className="gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              Carte
            </TabsTrigger>
          </TabsList>

          <TabsContent value="groups">
            <GroupsSection
              groups={groups}
              groupsLoading={groupsLoading}
              nodes={nodes}
              busyKey={busyKey}
              setBusyKey={setBusyKey}
              setNotice={setNotice}
              refreshGroups={refreshGroups}
              journal={journal}
            />
          </TabsContent>

          <TabsContent value="zones">
            <ZonesSection
              zones={zones}
              zonesLoading={zonesLoading}
              groups={groups}
              busyKey={busyKey}
              setBusyKey={setBusyKey}
              setNotice={setNotice}
              refreshZones={refreshZones}
              journal={journal}
              onOpenRecordDialog={openRecordDialog}
              onOpenDelegation={openDelegation}
              onOpenDnssec={openDnssec}
            />
          </TabsContent>

          <TabsContent value="map">
            <GeoMapSection nodes={nodes} groups={groups} zones={zones} />
          </TabsContent>
        </Tabs>
      </div>

      <GroupDialog
        open={groupDialogOpen}
        onOpenChange={setGroupDialogOpen}
        nodes={nodes}
        onCreated={async () => {
          await refreshGroups();
        }}
        onNotice={setNotice}
      />

      <ZoneDialog
        open={zoneDialogOpen}
        onOpenChange={setZoneDialogOpen}
        groups={groups}
        onCreated={async () => {
          await refreshZones();
        }}
        onNotice={setNotice}
      />

      {recordDialogTarget && (
        <RecordDialog
          key={`${recordDialogTarget.zoneId}:${recordDialogTarget.record?.id ?? 'new'}`}
          target={recordDialogTarget}
          nodes={nodes}
          onClose={() => setRecordDialogTarget(null)}
          onSaved={async () => {
            await refreshZones();
          }}
          onNotice={setNotice}
        />
      )}

      <DelegationDnssecDialog infoPanel={infoPanel} onClose={() => setInfoPanel(null)} />
    </>
  );
}
