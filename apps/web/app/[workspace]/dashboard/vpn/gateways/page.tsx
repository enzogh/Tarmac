'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, DoorOpen, Globe2, RadioTower, Search, Users } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Callout } from '@/components/Callout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Stat, StatRow } from '@/components/ui/stat';
import { StatusPill } from '@/components/ui/status';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { StatCardSkeleton, TableRowSkeleton } from '@/components/ui/skeleton';
import { api, VpnGateway } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { usePolling } from '@/lib/hooks/usePolling';
import { NodeLabel, nodeLocation, useVpnLive } from '../components/vpn-ui';

function SyncState({ gateway }: { gateway: VpnGateway }) {
  const carriesVpn = gateway.entryProfiles > 0 || gateway.exitProfiles > 0;
  if (gateway.apply.status === 'error') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <StatusPill tone="danger">Erreur</StatusPill>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm font-mono text-2xs">{gateway.apply.error}</TooltipContent>
      </Tooltip>
    );
  }
  if (!carriesVpn) return <span className="text-xs text-muted-foreground">Non utilisé</span>;
  if (gateway.apply.status === 'outdated') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <StatusPill tone="warn">Agent à mettre à jour</StatusPill>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm">{gateway.apply.error}</TooltipContent>
      </Tooltip>
    );
  }
  if (gateway.status === 'offline') return <StatusPill tone="warn">Hors ligne</StatusPill>;
  if (gateway.apply.status === 'active') {
    return (
      <span title={gateway.apply.revision ?? undefined}>
        <StatusPill tone="ok">Synchronisé</StatusPill>
        {gateway.apply.revision && (
          <span className="ml-2 text-2xs text-muted-foreground">{formatRelative(gateway.apply.revision)}</span>
        )}
      </span>
    );
  }
  return <StatusPill tone="warn">En attente</StatusPill>;
}

export default function VpnGatewaysPage() {
  const params = useParams<{ workspace: string }>();
  const { data: gateways = [], mutate, isLoading } = usePolling('vpn-gateways', api.vpn.gateways, { intervalMs: 10000 });
  useVpnLive(() => void mutate());

  const entries = gateways.filter((gateway) => gateway.entryProfiles > 0);
  const exits = gateways.filter((gateway) => gateway.exitProfiles > 0);
  const connected = gateways.reduce((sum, gateway) => sum + gateway.connectedClients, 0);
  const errors = gateways.filter((gateway) => gateway.apply.status === 'error');
  const outdated = gateways.filter((gateway) => gateway.apply.status === 'outdated' && gateway.entryProfiles > 0);
  const listenPort = gateways[0]?.listenPort ?? 51821;
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return gateways;
    return gateways.filter((gateway) =>
      [gateway.name, gateway.publicIp, gateway.vlanIp, gateway.locationCity, gateway.locationCountry]
        .filter(Boolean)
        .some((value) => (value as string).toLowerCase().includes(needle)),
    );
  }, [gateways, query]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Passerelles VPN"
        description="Les nœuds qui servent de point d'entrée aux appareils ou de sortie vers Internet, et l'état de leur configuration."
        actionsReadOnlySafe
        actions={
          <Button variant="secondary" asChild>
            <Link href={`/${params.workspace}/dashboard/vpn`} className="gap-1.5">
              <ArrowLeft className="h-4 w-4" />
              Profils VPN
            </Link>
          </Button>
        }
      />

      {errors.length > 0 && (
        <Callout variant="danger">
          {errors.length} nœud{errors.length > 1 ? 's n’ont' : ' n’a'} pas pu appliquer la configuration VPN (
          {errors.map((gateway) => gateway.name).join(', ')}). Survolez le statut pour voir l&apos;erreur.
        </Callout>
      )}

      {outdated.length > 0 && (
        <Callout variant="warning">
          {outdated.map((gateway) => gateway.name).join(', ')} : agent trop ancien pour appliquer les règles d&apos;accès des
          profils — leurs appareils ne sont pas cloisonnés. Mettez à jour l&apos;agent depuis la page Nœuds.
        </Callout>
      )}

      {isLoading ? (
        <StatRow>
          {Array.from({ length: 4 }).map((_, index) => (
            <StatCardSkeleton key={index} />
          ))}
        </StatRow>
      ) : (
        <StatRow className="animate-fade-in">
          <Stat label="Points d'entrée actifs" value={entries.length} icon={DoorOpen} hint={`${gateways.filter((g) => g.entryEligibility === null).length} éligible(s)`} />
          <Stat label="Nœuds de sortie actifs" value={exits.length} icon={Globe2} />
          <Stat label="Appareils connectés" value={connected} icon={Users} tone={connected > 0 ? 'ok' : 'neutral'} />
          <Stat
            label="Synchronisation"
            value={errors.length > 0 ? `${errors.length} erreur(s)` : 'OK'}
            icon={RadioTower}
            tone={errors.length > 0 ? 'danger' : 'ok'}
          />
        </StatRow>
      )}

      <Callout variant="info">
        Les appareils se connectent en UDP sur le port <span className="font-mono">{listenPort}</span> du point
        d&apos;entrée. Si votre hébergeur filtre le trafic en amont (pare-feu réseau OVH, Security Groups…), autorisez ce
        port. Le pare-feu local du nœud est configuré automatiquement par l&apos;agent.
      </Callout>

      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Nœuds du workspace</CardTitle>
            <CardDescription>
              Un même nœud peut être à la fois point d&apos;entrée et sortie. Le trafic entre l&apos;entrée et la sortie
              transite par le réseau privé chiffré.
            </CardDescription>
          </div>
          {gateways.length > 6 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Nœud, IP, ville…"
                className="h-8 w-56 pl-8"
              />
            </div>
          )}
        </CardHeader>
        <CardContent flush>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nœud</TableHead>
                <TableHead>Localisation</TableHead>
                <TableHead>Entrée</TableHead>
                <TableHead>Sortie</TableHead>
                <TableHead>Connectés</TableHead>
                <TableHead>Sous-réseau clients</TableHead>
                <TableHead>Configuration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 3 }).map((_, index) => <TableRowSkeleton key={index} columns={7} />)
                : visible.map((gateway) => (
                    <TableRow key={gateway.id}>
                      <TableCell>
                        <NodeLabel node={gateway} showIp />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{nodeLocation(gateway) ?? '—'}</TableCell>
                      <TableCell>
                        {gateway.entryEligibility ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>
                                <StatusPill tone="neutral">Indisponible</StatusPill>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">{gateway.entryEligibility}</TooltipContent>
                          </Tooltip>
                        ) : gateway.entryProfiles > 0 ? (
                          <span className="text-sm text-foreground">
                            {gateway.entryProfiles} profil{gateway.entryProfiles > 1 ? 's' : ''}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Disponible</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {gateway.exitProfiles > 0 ? (
                          <span className="text-sm text-foreground">
                            {gateway.exitProfiles} profil{gateway.exitProfiles > 1 ? 's' : ''}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">{gateway.exitEligibility ? 'Indisponible' : 'Disponible'}</span>
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums">{gateway.connectedClients}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{gateway.clientSubnet ?? '—'}</TableCell>
                      <TableCell>
                        <SyncState gateway={gateway} />
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
          {!isLoading && visible.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {gateways.length === 0 ? 'Aucun nœud dans ce workspace.' : 'Aucun nœud ne correspond à cette recherche.'}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
