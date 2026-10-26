'use client';

import { ReactNode, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpToLine,
  Bell,
  BellOff,
  Cpu,
  Gauge,
  Globe,
  HardDrive,
  LoaderCircle,
  Pencil,
  RefreshCcw,
  RotateCcw,
  Thermometer,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/Callout';
import { CopyButton } from '@/components/ui/copy-button';
import { Progress } from '@/components/ui/progress';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { NODE_STATUS, StatusPill, describe } from '@/components/ui/status';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SmartTrendChart } from '@/components/dashboard-charts';
import { api, DnsNodeRecordRef, NodeActivityItem, SmartHistoryPoint } from '@/lib/api';
import { formatCapacity, formatRelative, formatThroughput } from '@/lib/format';
import { flagFromCountryCode, GeoInfo } from '@/lib/geo';
import { slugifyHostname } from './NodeDialogs';
import { externalIpOf, formatDateTime, InternalDnsBadge, InternalDnsState, isMuted, MiniMeter, nodeAttention, SMART_LABEL } from './node-ui';

type Tab = 'overview' | 'disks' | 'dns';

function Field({ label, children, mono, copy }: { label: string; children: ReactNode; mono?: boolean; copy?: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs text-muted-foreground">{label}</dt>
      <dd className={`flex items-center gap-1 ${mono ? 'font-mono text-xs' : 'text-sm'} text-foreground`}>
        <span className="truncate">{children}</span>
        {copy && <CopyButton value={copy} iconOnly />}
      </dd>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>;
}

const chartData = (points: SmartHistoryPoint[]) =>
  points.map((point) => ({
    label: new Date(point.collectedAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
    temperatureC: point.temperatureC,
    reallocatedSectors: point.reallocatedSectors,
    pendingSectors: point.pendingSectors,
  }));

export function NodeDrawer({
  node,
  initialTab = 'overview',
  geo,
  labels,
  internalDns,
  dnsBusy,
  updating,
  smartBusy,
  onOpenChange,
  onEdit,
  onUpdateAgent,
  onToggleMute,
  onDelete,
  onToggleSmart,
  onDesignateDns,
  onClearDns,
  onRetryDns,
  onResolveForwarder,
}: {
  node: NodeActivityItem | null;
  initialTab?: Tab;
  geo: GeoInfo | null;
  labels: string[];
  internalDns: InternalDnsState | undefined;
  dnsBusy: boolean;
  updating: boolean;
  smartBusy: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
  onUpdateAgent: () => void;
  onToggleMute: () => void;
  onDelete: () => void;
  onToggleSmart: () => void;
  onDesignateDns: () => void;
  onClearDns: () => void;
  onRetryDns: () => void;
  onResolveForwarder: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [records, setRecords] = useState<DnsNodeRecordRef[] | null>(null);
  const [history, setHistory] = useState<Record<string, SmartHistoryPoint[]>>({});
  const nodeId = node?.id;

  useEffect(() => {
    setTab(initialTab);
    setRecords(null);
    setHistory({});
  }, [nodeId, initialTab]);

  useEffect(() => {
    if (!nodeId || tab !== 'dns' || records) return;
    let cancelled = false;
    api.dns
      .recordsForNode(nodeId)
      .then((result) => !cancelled && setRecords(result))
      .catch(() => !cancelled && setRecords([]));
    return () => {
      cancelled = true;
    };
  }, [nodeId, tab, records]);

  useEffect(() => {
    if (!node || tab !== 'disks') return;
    const missing = node.storage.disks.filter((disk) => disk.smart && disk.smartDiskName && !history[disk.id]);
    if (missing.length === 0) return;
    let cancelled = false;
    void Promise.all(
      missing.map(async (disk) => {
        try {
          return [disk.id, await api.nodes.smartHistory(node.id, disk.smartDiskName as string)] as const;
        } catch {
          return [disk.id, [] as SmartHistoryPoint[]] as const;
        }
      }),
    ).then((entries) => !cancelled && setHistory((current) => ({ ...current, ...Object.fromEntries(entries) })));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, tab]);

  if (!node) return <Sheet open={false} onOpenChange={onOpenChange}>{null}</Sheet>;

  const status = describe(NODE_STATUS, node.status);
  const isDnsNode = internalDns?.internalDnsNodeId === node.id;
  const otherDnsNode = internalDns?.internalDnsNodeId && !isDnsNode;
  const attention = nodeAttention(node);
  const offline = node.status === 'offline';
  const hostname = node.dnsHostname || slugifyHostname(node.name);
  const smartEnabled = node.smartMonitoringEnabled !== false;

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent aria-describedby={undefined} className="max-w-2xl">
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle className="truncate">{node.name}</SheetTitle>
            <StatusPill tone={status.tone}>{status.label}</StatusPill>
            {isDnsNode && internalDns && <InternalDnsBadge status={internalDns.internalDnsStatus} />}
          </div>
          <SheetDescription>
            <span className="capitalize">{node.role}</span>
            {geo && ` · ${flagFromCountryCode(geo.countryCode)} ${[geo.city, geo.country].filter(Boolean).join(', ')}`}
            {' · vu '}
            {formatRelative(node.lastSeenAt)}
          </SheetDescription>
          {labels.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {labels.map((label) => (
                <span key={label} className="rounded bg-surface-3 px-1.5 py-px text-2xs text-muted-foreground">
                  {label}
                </span>
              ))}
            </div>
          )}
          <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="pt-2">
            <TabsList variant="segmented">
              <TabsTrigger value="overview">Aperçu</TabsTrigger>
              <TabsTrigger value="disks">Disques</TabsTrigger>
              <TabsTrigger value="dns">DNS</TabsTrigger>
            </TabsList>
          </Tabs>
        </SheetHeader>

        <SheetBody className="space-y-6">
          {tab === 'overview' && (
            <>
              {attention.length > 0 && (
                <Callout variant="warning">À surveiller : {attention.join(' · ')}</Callout>
              )}
              <section>
                <SectionTitle>Charge</SectionTitle>
                <div className="grid gap-2 rounded-lg border border-border bg-surface-2/40 p-3">
                  {[
                    { icon: Cpu, label: 'CPU', value: offline ? null : node.metrics.cpu },
                    { icon: Gauge, label: 'RAM', value: offline ? null : node.metrics.ram },
                    {
                      icon: HardDrive,
                      label: `Stockage · ${formatCapacity(node.storage.totalUsedGb)} / ${formatCapacity(node.storage.totalCapacityGb)}`,
                      value: node.storage.usageRatio * 100,
                    },
                  ].map((meter) => (
                    <div key={meter.label} className="grid grid-cols-[minmax(0,12rem)_1fr] items-center gap-3 text-xs">
                      <span className="flex items-center gap-1.5 truncate text-muted-foreground">
                        <meter.icon className="h-3.5 w-3.5" />
                        {meter.label}
                      </span>
                      {meter.value === null ? <span className="text-muted-foreground">Hors ligne</span> : <MiniMeter value={meter.value} />}
                    </div>
                  ))}
                  <div className="flex gap-4 border-t border-border pt-2 text-xs tabular-nums text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <ArrowDownToLine className="h-3 w-3" />
                      {formatThroughput(node.metrics.networkRx)}
                    </span>
                    <span className="flex items-center gap-1">
                      <ArrowUpToLine className="h-3 w-3" />
                      {formatThroughput(node.metrics.networkTx)}
                    </span>
                    <span className="ml-auto" title={formatDateTime(node.metrics.sampledAt)}>
                      Mesuré {formatRelative(node.metrics.sampledAt)}
                    </span>
                  </div>
                </div>
              </section>

              <section>
                <SectionTitle>Réseau</SectionTitle>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <Field label="IP publique" mono copy={externalIpOf(node)}>
                    {externalIpOf(node) ?? '—'}
                  </Field>
                  <Field label="IP privée (réseau Tarmac)" mono copy={node.vlanIp}>
                    {node.vlanIp ?? 'Pas encore rejoint'}
                  </Field>
                  <Field label="Endpoint WireGuard" mono>
                    {node.overlayEndpoint || '—'}
                  </Field>
                  <Field label="Nom interne" mono>
                    {hostname}.tarmac.local
                  </Field>
                </dl>
              </section>

              <section>
                <SectionTitle>Agent</SectionTitle>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-2/40 p-3">
                  <dl className="grid flex-1 grid-cols-2 gap-x-4 gap-y-2">
                    <Field label="Version" mono>
                      {node.agentVersion ?? 'jamais rapportée'}
                    </Field>
                    <Field label="Contrôleur" mono>
                      {node.controlVersion ?? '—'}
                    </Field>
                  </dl>
                  {node.agentUpToDate === false ? (
                    <Button size="sm" onClick={onUpdateAgent} disabled={offline || updating} className="gap-1.5">
                      <RefreshCcw className={`h-3.5 w-3.5 ${updating ? 'animate-spin' : ''}`} />
                      Mettre à jour
                    </Button>
                  ) : (
                    <Badge label={node.agentUpToDate ? 'À jour' : 'Version inconnue'} type={node.agentUpToDate ? 'success' : 'info'} />
                  )}
                </div>
              </section>

              <section>
                <SectionTitle>Identifiant</SectionTitle>
                <Field label="Node ID" mono copy={node.id}>
                  {node.id}
                </Field>
              </section>
            </>
          )}

          {tab === 'disks' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Surveillance SMART</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {smartEnabled
                      ? 'Sur un VPS, les attributs SMART sont ceux de l’hyperviseur ou absents — désactivez-la si les alertes ne sont pas exploitables.'
                      : 'Désactivée : aucune alerte disque ne sera levée pour ce nœud.'}
                  </p>
                </div>
                <Button variant={smartEnabled ? 'secondary' : 'default'} size="sm" disabled={smartBusy} onClick={onToggleSmart} className="shrink-0 gap-1.5">
                  {smartEnabled ? <BellOff className="h-3.5 w-3.5" /> : <Thermometer className="h-3.5 w-3.5" />}
                  {smartEnabled ? 'Désactiver' : 'Réactiver'}
                </Button>
              </div>
              {node.storage.disks.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border bg-surface-2 px-3 py-6 text-center text-xs text-muted-foreground">
                  Aucun disque remonté par l’agent.
                </p>
              ) : (
                node.storage.disks.map((disk) => (
                  <div key={disk.id} className="rounded-lg border border-border bg-surface-2/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-mono text-sm text-foreground">{disk.mountPath}</p>
                      <span className="text-2xs uppercase text-muted-foreground">{disk.type}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {formatCapacity(disk.usedGb)} / {formatCapacity(disk.capacityGb)}
                      </span>
                      <span>{Math.round(disk.usageRatio * 100)} %</span>
                    </div>
                    <Progress value={disk.usageRatio * 100} className="mt-1.5 h-1.5" />
                    {disk.smart ? (
                      <>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Badge {...SMART_LABEL[disk.smart.overall]} />
                          <span>{disk.smart.temperatureC}°C</span>
                          <span>{disk.smart.reallocatedSectors} secteurs réalloués</span>
                          <span>{disk.smart.pendingSectors} en attente</span>
                          <span>{Math.round(disk.smart.powerOnHours / 24)} j. d’activité</span>
                        </div>
                        <div className="mt-3 rounded-md border border-border bg-background p-2">
                          {history[disk.id] ? (
                            <SmartTrendChart data={chartData(history[disk.id])} />
                          ) : (
                            <p className="py-6 text-center text-xs text-muted-foreground">Chargement de l’historique…</p>
                          )}
                        </div>
                      </>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">Pas de données SMART (disque réseau, VPS ou smartctl indisponible).</p>
                    )}
                  </div>
                ))
              )}
            </>
          )}

          {tab === 'dns' && (
            <>
              <section>
                <SectionTitle>Serveur DNS interne de la flotte</SectionTitle>
                <div className="space-y-3 rounded-lg border border-border bg-surface-2/40 p-3">
                  {isDnsNode && internalDns ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <InternalDnsBadge status={internalDns.internalDnsStatus} />
                        <span className="text-xs text-muted-foreground">
                          Ce nœud sert la zone <span className="font-mono">tarmac.local</span> à toute la flotte
                          {internalDns.records.length > 0 && ` (${internalDns.records.length} noms)`}.
                        </span>
                      </div>
                      {internalDns.internalDnsStatus === 'error' && (
                        <Callout variant="danger">
                          <span className="block space-y-2">
                            <span className="block font-medium">L’agent n’a pas pu installer le serveur DNS.</span>
                            {internalDns.internalDnsError ? (
                              <span className="block break-words rounded-md bg-background/60 px-2 py-1.5 font-mono text-2xs leading-relaxed">
                                {internalDns.internalDnsError}
                              </span>
                            ) : (
                              <span className="block text-xs">Le détail est dans le Journal de ce nœud.</span>
                            )}
                            <span className="block text-xs">Une nouvelle tentative part automatiquement toutes les 5 minutes.</span>
                            <Button size="sm" variant="secondary" onClick={onRetryDns} disabled={dnsBusy || offline} className="gap-1.5">
                              {dnsBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                              Réessayer maintenant
                            </Button>
                          </span>
                        </Callout>
                      )}
                      {offline && <Callout variant="danger">Ce nœud est hors ligne : la résolution des noms internes est interrompue.</Callout>}
                      <Button variant="secondary" size="sm" onClick={onClearDns} disabled={dnsBusy} className="gap-1.5">
                        {dnsBusy && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                        Retirer le rôle DNS interne
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Un seul nœud par workspace sert <span className="font-mono">*.tarmac.local</span> (PowerDNS sur le port 5300, sans
                        toucher au port 53). Tous les nœuds sont ensuite joignables par nom, par exemple{' '}
                        <span className="font-mono text-foreground">{hostname}.tarmac.local</span>.
                      </p>
                      {otherDnsNode && <Callout variant="info">Un autre nœud tient déjà ce rôle : le désigner ici le lui retire.</Callout>}
                      <Button size="sm" onClick={onDesignateDns} disabled={dnsBusy || !node.vlanIp} className="gap-1.5">
                        {dnsBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
                        Désigner comme DNS interne
                      </Button>
                      {!node.vlanIp && <p className="text-2xs text-muted-foreground">Le nœud doit d’abord rejoindre le réseau privé.</p>}
                    </>
                  )}
                </div>
              </section>

              <section>
                <SectionTitle>Résolveur local de ce nœud</SectionTitle>
                {node.internalDnsForwarderStatus === 'conflict' && node.internalDnsForwarderConflict ? (
                  <Callout variant="danger">
                    <span className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span className="space-y-2">
                        <span className="block">
                          Le port {node.internalDnsForwarderConflict.port}/{node.internalDnsForwarderConflict.protocol} est occupé par{' '}
                          <strong>{node.internalDnsForwarderConflict.processName ?? 'un process inconnu'}</strong>
                          {node.internalDnsForwarderConflict.pid ? ` (pid ${node.internalDnsForwarderConflict.pid})` : ''} : le résolveur de
                          repli (dnsmasq) n’a pas pu démarrer.
                        </span>
                        <Button size="sm" disabled={dnsBusy} onClick={onResolveForwarder}>
                          Tuer le process et réessayer
                        </Button>
                      </span>
                    </span>
                  </Callout>
                ) : (
                  <p className="rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-xs text-muted-foreground">
                    {node.internalDnsForwarderStatus === 'active'
                      ? 'Résolveur de repli actif : ce nœud résout *.tarmac.local.'
                      : node.internalDnsForwarderStatus === 'error'
                        ? 'Le résolveur de repli a échoué — voir le Journal.'
                        : internalDns?.internalDnsNodeId
                          ? 'Résolution via systemd-resolved (aucun résolveur de repli nécessaire).'
                          : 'Aucun DNS interne configuré dans la flotte.'}
                  </p>
                )}
              </section>

              <section>
                <SectionTitle>Enregistrements DNS publics pointant ici</SectionTitle>
                {records === null ? (
                  <p className="text-xs text-muted-foreground">Chargement…</p>
                ) : records.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Aucun enregistrement de vos zones ne pointe vers ce nœud.</p>
                ) : (
                  <div className="space-y-1.5">
                    {records.map((record) => (
                      <div key={record.recordId} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-xs">
                        <span className="font-mono text-foreground">
                          {record.recordName === '@' ? record.zoneName : `${record.recordName}.${record.zoneName}`}
                        </span>
                        <Badge label={record.type} type="info" />
                        {record.isGeo && <Badge label="Géo-routage" type="success" />}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </SheetBody>

        <SheetFooter>
          <Button variant="secondary" onClick={onEdit} className="gap-1.5">
            <Pencil className="h-4 w-4" />
            Modifier
          </Button>
          <Button variant="secondary" onClick={onToggleMute} className="gap-1.5">
            {isMuted(node) ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
            {isMuted(node) ? 'Réactiver les alertes' : 'Silence 1 h'}
          </Button>
          <span className="flex-1" />
          <Button variant="ghost" onClick={onDelete} className="gap-1.5 text-[hsl(var(--danger))]">
            <Trash2 className="h-4 w-4" />
            Supprimer
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
