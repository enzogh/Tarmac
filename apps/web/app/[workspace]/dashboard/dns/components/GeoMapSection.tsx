'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { MapPin } from 'lucide-react';
import { api, DnsNodeRecordRef, DnsServerGroupItem, DnsZoneItem, NodeItem } from '@/lib/api';
import { Callout } from '@/components/Callout';
import { SectionLabel } from '@/components/SectionLabel';
import { Badge } from '@/components/ui';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { WorldMapNode } from '@/components/WorldMap';

const WorldMap = dynamic(() => import('@/components/WorldMap').then((mod) => mod.WorldMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-[420px] items-center justify-center rounded-xl border border-white/[0.08] bg-zinc-950/50 text-sm text-muted-foreground">
      Chargement de la carte…
    </div>
  ),
});

// Geo tab: which servers are DNS-relevant (group member or a record's geo
// target) and, once one is clicked, what points to it - reuses the same
// reverse-lookup endpoint as the infrastructure page's node detail panel.
export function GeoMapSection({ nodes, groups, zones }: { nodes: NodeItem[]; groups: DnsServerGroupItem[]; zones: DnsZoneItem[] }) {
  const [geoPanel, setGeoPanel] = useState<{ node: NodeItem; records: DnsNodeRecordRef[] | null; loading: boolean } | null>(
    null,
  );

  const dnsRelevantNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const group of groups) {
      for (const member of group.members) ids.add(member.nodeId);
    }
    for (const zone of zones) {
      for (const record of zone.records) {
        for (const value of record.values) {
          if (value.nodeId) ids.add(value.nodeId);
        }
      }
    }
    return ids;
  }, [groups, zones]);

  const dnsWorldMapNodes: WorldMapNode[] = useMemo(
    () =>
      nodes
        .filter((node) => dnsRelevantNodeIds.has(node.id) && node.locationLat != null && node.locationLng != null)
        .map((node) => ({
          id: node.id,
          label: node.name,
          vlanIp: node.externalIp ?? '',
          status: node.status,
          city: node.locationCity ?? '',
          country: node.locationCountry ?? '',
          countryCode: node.locationCountryCode ?? null,
          lat: node.locationLat as number,
          lng: node.locationLng as number,
          isPositionApproximate: false,
        })),
    [nodes, dnsRelevantNodeIds],
  );

  const openGeoNode = (nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    setGeoPanel({ node, records: null, loading: true });
    api.dns
      .recordsForNode(nodeId)
      .then((records) => setGeoPanel({ node, records, loading: false }))
      .catch(() => setGeoPanel({ node, records: [], loading: false }));
  };

  return (
    <>
      <section className="space-y-4">
        <SectionLabel>Carte géographique</SectionLabel>
        <Callout variant="info">
          Serveurs DNS et cibles géo-routées de ta flotte. Clique sur un marqueur pour voir quelles zones/records le
          ciblent.
        </Callout>
        {dnsWorldMapNodes.length === 0 ? (
          <Card className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
            <CardContent className="pt-12 pb-12 text-center">
              <MapPin className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
              <p className="font-medium text-muted-foreground">Aucun nœud géolocalisé impliqué dans le DNS</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Renseigne la localisation de tes nœuds depuis la page Infrastructure pour les voir apparaître ici.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden border-white/[0.08] bg-zinc-900/65 backdrop-blur">
            <WorldMap nodes={dnsWorldMapNodes} onSelectNode={openGeoNode} className="h-[420px] w-full" />
          </Card>
        )}
      </section>

      <Dialog open={!!geoPanel} onOpenChange={(open) => !open && setGeoPanel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enregistrements DNS pointant vers « {geoPanel?.node.name} »</DialogTitle>
          </DialogHeader>
          {geoPanel?.loading ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : geoPanel?.records && geoPanel.records.length > 0 ? (
            <div className="space-y-1.5">
              {geoPanel.records.map((record) => (
                <div
                  key={record.recordId}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.08] bg-zinc-950/50 p-2.5 text-sm"
                >
                  <span className="font-mono text-zinc-200">
                    {record.recordName === '@' ? record.zoneName : `${record.recordName}.${record.zoneName}`}
                  </span>
                  <Badge label={record.type} type="info" />
                  {record.isGeo && <Badge label="Géo-routage" type="success" />}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Aucun enregistrement DNS ne pointe vers ce nœud.</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
