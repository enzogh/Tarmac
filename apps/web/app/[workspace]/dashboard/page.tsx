'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  ArrowRightLeft,
  Bell,
  CheckCircle2,
  ChevronRight,
  Cpu,
  Globe,
  HardDrive,
  History,
  KeyRound,
  MemoryStick,
  Network,
  RefreshCcw,
  Server,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { api, AuditLogItem, NodeActivityItem, NodeHeartbeatLiveEvent } from '../../../lib/api';
import { auditVerb } from '../../../lib/audit-vocabulary';
import { usePolling } from '../../../lib/hooks/usePolling';
import { useLiveSocket } from '../../../lib/hooks/useLiveSocket';
import { formatBytes, formatCapacity, formatCapacityGb, formatRelative, shortHostname } from '../../../lib/format';
import { flagFromCountryCode } from '../../../lib/geo';
import { cpuShape, memoryUsage } from '../../../lib/system-info';
import { summarizeLinks } from '../../../lib/vlan-links';
import { cn } from '../../../lib/utils';
import { PageHeader } from '../../../components/PageHeader';
import { FleetPerformanceChart, NetworkThroughputChart, StorageBreakdownChart } from '../../../components/dashboard-charts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { Stat, StatRow } from '../../../components/ui/stat';
import { NODE_STATUS, SEVERITY, StatusDot, StatusPill, describe, type StatusTone } from '../../../components/ui/status';
import { Progress } from '../../../components/ui/progress';
import { BannerSkeleton, ChartCardSkeleton, ListSkeleton, StatCardSkeleton } from '../../../components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '../../../components/ui/tabs';
import { MiniMeter, SwapLine } from './infrastructure/components/node-ui';

type Range = '1h' | '6h' | '24h';
const RANGE_LABEL: Record<Range, string> = { '1h': '1 h', '6h': '6 h', '24h': '24 h' };

type Issue = { tone: 'danger' | 'warn'; icon: LucideIcon; title: string; detail?: string; href: string; action: string };

function SectionCard({
  icon: Icon,
  title,
  description,
  href,
  linkLabel,
  actions,
  children,
  className,
  flush,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  href?: string;
  linkLabel?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <Card className={cn('flex flex-col overflow-hidden', className)}>
      <CardHeader>
        <CardTitle>
          <Icon className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
        <div className="flex items-center gap-2">
          {actions}
          {href && (
            <Link href={href} className="inline-flex items-center gap-1 text-2xs text-muted-foreground transition-colors hover:text-foreground">
              {linkLabel ?? 'Tout voir'}
              <ChevronRight className="h-3 w-3" />
            </Link>
          )}
        </div>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <div className={cn('flex-1', !flush && 'p-4 lg:p-5')}>{children}</div>
    </Card>
  );
}

function HealthBanner({ issues, loading }: { issues: Issue[]; loading: boolean }) {
  if (loading) return <BannerSkeleton />;
  const critical = issues.filter((issue) => issue.tone === 'danger').length;
  const tone = critical > 0 ? 'danger' : issues.length > 0 ? 'warn' : 'ok';
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border',
        tone === 'ok' && 'border-[hsl(var(--ok))]/25 bg-[hsl(var(--ok))]/[0.05]',
        tone === 'warn' && 'border-[hsl(var(--warn))]/25 bg-[hsl(var(--warn))]/[0.05]',
        tone === 'danger' && 'border-[hsl(var(--danger))]/25 bg-[hsl(var(--danger))]/[0.05]',
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3.5 lg:px-5">
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
            tone === 'ok' && 'bg-[hsl(var(--ok))]/15 text-[hsl(var(--ok))]',
            tone === 'warn' && 'bg-[hsl(var(--warn))]/15 text-[hsl(var(--warn))]',
            tone === 'danger' && 'bg-[hsl(var(--danger))]/15 text-[hsl(var(--danger))]',
          )}
        >
          {tone === 'ok' ? <Sparkles className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {tone === 'ok'
              ? 'Tout fonctionne normalement'
              : `${issues.length} point${issues.length > 1 ? 's' : ''} demande${issues.length > 1 ? 'nt' : ''} votre attention`}
          </p>
          <p className="text-xs text-muted-foreground">
            {tone === 'ok'
              ? 'Nœuds, réseau privé, DNS interne, VPN et alertes : rien à signaler.'
              : 'Du plus urgent au moins urgent. Chaque ligne mène à l’endroit où le régler.'}
          </p>
        </div>
      </div>
      {issues.length > 0 && (
        <ul className="divide-y divide-border/60 border-t border-border/60 bg-surface-1/60">
          {issues.map((issue, index) => (
            <li key={index}>
              <Link href={issue.href} className="group flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2/60 lg:px-5">
                <issue.icon className={cn('h-4 w-4 shrink-0', issue.tone === 'danger' ? 'text-[hsl(var(--danger))]' : 'text-[hsl(var(--warn))]')} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">{issue.title}</span>
                  {issue.detail && <span className="block truncate text-2xs text-muted-foreground">{issue.detail}</span>}
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-2xs text-muted-foreground group-hover:text-foreground">
                  {issue.action}
                  <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ServiceRow({
  icon: Icon,
  name,
  tone,
  status,
  detail,
  href,
}: {
  icon: LucideIcon;
  name: string;
  tone: StatusTone;
  status: string;
  detail: string;
  href: string;
}) {
  return (
    <Link href={href} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2/50 lg:px-5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted-foreground group-hover:text-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{name}</span>
        <span className="block truncate text-2xs text-muted-foreground">{detail}</span>
      </span>
      <StatusPill tone={tone}>{status}</StatusPill>
    </Link>
  );
}

function ActivityLine({ entry, refs }: { entry: AuditLogItem; refs: Record<string, string> }) {
  const { verb, needsResource } = auditVerb(entry.action, entry.resourceType);
  const detailsName = (entry.details as { name?: unknown } | null)?.name;
  const resource =
    (entry.resourceId && refs[entry.resourceId]) || (typeof detailsName === 'string' ? detailsName : null) || null;
  const viaKey = (entry.details as { apiKey?: { name?: string } } | null)?.apiKey?.name;
  const actor = entry.actor?.name ?? (viaKey ? `Clé API « ${viaKey} »` : 'Tarmac');
  return (
    <li className="flex gap-3 px-4 py-2.5 lg:px-5">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[9px] font-semibold text-primary">
        {actor
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0])
          .join('')
          .toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-5 text-muted-foreground">
          <span className="font-medium text-foreground">{actor}</span> {verb}
          {needsResource && resource && <span className="font-medium text-foreground"> {shortHostname(resource)}</span>}
        </p>
        <p className="text-2xs text-muted-foreground/80" title={new Date(entry.createdAt).toLocaleString('fr-FR')}>
          {formatRelative(entry.createdAt)}
        </p>
      </div>
    </li>
  );
}

export default function OverviewPage() {
  const params = useParams<{ workspace: string }>();
  const base = `/${params.workspace}/dashboard`;
  const [range, setRange] = useState<Range>('24h');

  const { data: activitiesRaw, isLoading: nodesLoading, mutate: mutateActivities } = usePolling('activity:1h', () => api.nodes.activity(), {
    intervalMs: 30000,
  });
  const nodes = useMemo(() => activitiesRaw ?? [], [activitiesRaw]);

  // Heartbeats patch the list live; the poll only refreshes what they don't
  // carry. Bails out before the first poll: an updater returning undefined
  // would poison the SWR cache (see infrastructure/page.tsx).
  useLiveSocket((message) => {
    if (message.type !== 'node.heartbeat' || !activitiesRaw) return;
    const update = message.payload as NodeHeartbeatLiveEvent;
    void mutateActivities(
      (current) =>
        current?.map((node): NodeActivityItem =>
          node.id === update.nodeId
            ? {
                ...node,
                status: update.status,
                lastSeenAt: update.lastSeenAt,
                agentVersion: update.agentVersion,
                agentVersionAt: update.agentVersionAt,
                agentUpToDate: update.agentVersion && node.controlVersion ? update.agentVersion === node.controlVersion : null,
                metrics: { ...update.metrics, sampledAt: update.lastSeenAt },
                systemInfo: update.system ?? node.systemInfo,
              }
            : node,
        ) ?? current,
      { revalidate: false },
    );
  });

  const { data: series, isLoading: seriesLoading } = usePolling(`activity-series:${range}`, () => api.nodes.activitySeries(range), { intervalMs: 60000 });
  const { data: alerts = [], isLoading: alertsLoading } = usePolling('alerts', api.alerts.list, { intervalMs: 20000 });
  const { data: syncJobs = [] } = usePolling('sync-jobs', api.syncJobs.list, { intervalMs: 30000 });
  const { data: migrations = [] } = usePolling('migrations', api.migrations.list, { intervalMs: 30000 });
  const { data: internalDns } = usePolling('dns-internal', api.dns.internal.getStatus, { intervalMs: 30000, redirectOnError: false });
  const { data: vpnProfiles = [] } = usePolling('vpn-profiles', api.vpn.list, { intervalMs: 30000, redirectOnError: false });
  const { data: network } = usePolling(
    'overview-network',
    async () => {
      const { vlans } = await api.vlan.getAll();
      if (vlans.length === 0) return null;
      const [status, connections] = await Promise.all([api.vlan.getStatus(vlans[0].id), api.vlan.getConnections(vlans[0].id)]);
      return summarizeLinks(status.vlan.members ?? [], connections.connections);
    },
    { intervalMs: 30000, redirectOnError: false },
  );
  const { data: audit } = usePolling('overview-audit', () => api.auditLogs.list({ limit: 7 }), { intervalMs: 30000, redirectOnError: false });

  // --- derived ----------------------------------------------------------

  const online = nodes.filter((node) => node.status === 'online');
  const offline = nodes.filter((node) => node.status === 'offline');
  const degraded = nodes.filter((node) => node.status === 'degraded');
  const reachable = nodes.filter((node) => node.status !== 'offline');
  const avg = (pick: (node: NodeActivityItem) => number) => (reachable.length ? reachable.reduce((acc, node) => acc + pick(node), 0) / reachable.length : 0);
  const avgCpu = avg((node) => node.metrics.cpu);

  const capacity = useMemo(() => {
    let threads = 0;
    let memTotal = 0;
    let memUsed = 0;
    let reporting = 0;
    for (const node of nodes) {
      const info = node.systemInfo;
      if (!info) continue;
      reporting++;
      threads += info.cpuThreads ?? 0;
      if (info.memTotalBytes) {
        memTotal += info.memTotalBytes;
        if (node.status !== 'offline') memUsed += (info.memTotalBytes * node.metrics.ram) / 100;
      }
    }
    return { threads, memTotal, memUsed, reporting };
  }, [nodes]);

  const storageUsedGb = nodes.reduce((acc, node) => acc + node.storage.totalUsedGb, 0);
  const storageTotalGb = nodes.reduce((acc, node) => acc + node.storage.totalCapacityGb, 0);
  const storageRatio = storageTotalGb > 0 ? (storageUsedGb / storageTotalGb) * 100 : 0;
  const storageUsed = formatCapacityGb(storageUsedGb);

  const openAlerts = alerts.filter((alert) => alert.status !== 'resolved');
  const distinctOpen = useMemo(() => {
    const byMessage = new Map<string, (typeof openAlerts)[number]>();
    for (const alert of openAlerts) {
      const current = byMessage.get(alert.message);
      if (!current || new Date(alert.triggeredAt) > new Date(current.triggeredAt)) byMessage.set(alert.message, alert);
    }
    const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return [...byMessage.values()].sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || +new Date(b.triggeredAt) - +new Date(a.triggeredAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts]);
  const criticalAlerts = distinctOpen.filter((alert) => alert.severity === 'critical' || alert.severity === 'high');

  const vpnLive = vpnProfiles.filter((profile) => profile.enabled);
  const vpnConnected = vpnLive.filter((profile) => profile.session.connected).length;
  const vpnErrors = vpnLive.filter((profile) => profile.deployment.status === 'error').length;
  const outdatedAgents = nodes.filter((node) => node.status === 'online' && node.agentUpToDate === false);
  const failedJobs = syncJobs.filter((job) => job.status === 'failed');
  const runningJobs = syncJobs.filter((job) => job.status === 'running');
  const activeMigrations = migrations.filter((migration) => (migration.status === 'running' || migration.status === 'pending') && migration.progress < 100);
  const failedMigrations = migrations.filter((migration) => migration.status === 'failed');
  const fullNodes = nodes.filter((node) => node.storage.usageRatio >= 0.9);
  const dnsNode = nodes.find((node) => node.id === internalDns?.internalDnsNodeId) ?? null;
  const dnsUnreachable = nodes.filter((node) => node.status !== 'offline' && node.internalDnsForwarderStatus === 'unreachable');

  const issues = useMemo<Issue[]>(() => {
    const list: Issue[] = [];
    for (const node of offline) {
      list.push({
        tone: 'danger',
        icon: Server,
        title: `${shortHostname(node.name)} est hors ligne`,
        detail: node.lastSeenAt ? `Dernier signe de vie ${formatRelative(node.lastSeenAt)}` : undefined,
        href: `${base}/infrastructure`,
        action: 'Voir le nœud',
      });
    }
    if (criticalAlerts.length > 0) {
      list.push({
        tone: 'danger',
        icon: Bell,
        title: `${criticalAlerts.length} alerte${criticalAlerts.length > 1 ? 's' : ''} critique${criticalAlerts.length > 1 ? 's' : ''} ou élevée${criticalAlerts.length > 1 ? 's' : ''}`,
        detail: criticalAlerts[0]?.message,
        href: `${base}/alerts`,
        action: 'Traiter',
      });
    }
    if (internalDns?.internalDnsStatus === 'error') {
      list.push({ tone: 'danger', icon: Globe, title: 'Le DNS interne n’a pas pu s’installer', detail: internalDns.internalDnsError ?? undefined, href: `${base}/infrastructure`, action: 'Réessayer' });
    } else if (dnsUnreachable.length > 0) {
      list.push({
        tone: 'danger',
        icon: Globe,
        title: `DNS interne injoignable depuis ${dnsUnreachable.length} nœud${dnsUnreachable.length > 1 ? 's' : ''}`,
        detail: '*.tarmac.local ne se résout pas sur ces machines',
        href: `${base}/infrastructure`,
        action: 'Voir',
      });
    }
    if (network && network.offline > 0) {
      list.push({ tone: 'danger', icon: Network, title: `${network.offline} lien${network.offline > 1 ? 's' : ''} du réseau privé hors ligne`, href: `${base}/network`, action: 'Diagnostiquer' });
    }
    if (vpnErrors > 0) {
      list.push({ tone: 'danger', icon: KeyRound, title: `${vpnErrors} profil${vpnErrors > 1 ? 's' : ''} VPN en erreur de déploiement`, href: `${base}/vpn`, action: 'Voir' });
    }
    if (failedJobs.length + failedMigrations.length > 0) {
      list.push({
        tone: 'warn',
        icon: RefreshCcw,
        title: `${failedJobs.length + failedMigrations.length} transfert${failedJobs.length + failedMigrations.length > 1 ? 's' : ''} en échec`,
        detail: [...failedJobs.map((job) => job.name), ...failedMigrations.map((migration) => migration.name)].slice(0, 3).join(', '),
        href: failedJobs.length > 0 ? `${base}/replication` : `${base}/migrations`,
        action: 'Voir',
      });
    }
    for (const node of fullNodes) {
      list.push({ tone: 'warn', icon: HardDrive, title: `${shortHostname(node.name)} : stockage rempli à ${Math.round(node.storage.usageRatio * 100)} %`, href: `${base}/storage`, action: 'Voir' });
    }
    if (degraded.length > 0) {
      list.push({ tone: 'warn', icon: Server, title: `${degraded.length} nœud${degraded.length > 1 ? 's' : ''} dégradé${degraded.length > 1 ? 's' : ''}`, href: `${base}/infrastructure`, action: 'Voir' });
    }
    if (network && network.degraded > 0) {
      list.push({ tone: 'warn', icon: Network, title: `${network.degraded} lien${network.degraded > 1 ? 's' : ''} réseau dégradé${network.degraded > 1 ? 's' : ''}`, detail: 'Latence ou pertes élevées', href: `${base}/network`, action: 'Voir' });
    }
    if (outdatedAgents.length > 0) {
      list.push({
        tone: 'warn',
        icon: Sparkles,
        title: `${outdatedAgents.length} agent${outdatedAgents.length > 1 ? 's' : ''} à mettre à jour`,
        detail: 'Certaines fonctions récentes en dépendent',
        href: `${base}/infrastructure`,
        action: 'Mettre à jour',
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, criticalAlerts.length, internalDns, network, vpnErrors, syncJobs, migrations]);

  const chart = useMemo(() => {
    const byTime = new Map<string, { cpu: number; ram: number; rx: number; tx: number; count: number }>();
    for (const points of Object.values(series?.series ?? {})) {
      for (const point of points) {
        const row = byTime.get(point.t) ?? { cpu: 0, ram: 0, rx: 0, tx: 0, count: 0 };
        row.cpu += point.cpu;
        row.ram += point.ram;
        row.rx += point.networkRx;
        row.tx += point.networkTx;
        row.count++;
        byTime.set(point.t, row);
      }
    }
    const label = (iso: string) =>
      new Date(iso).toLocaleTimeString('fr-FR', range === '24h' ? { hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' });
    const rows = [...byTime.entries()].sort(([a], [b]) => a.localeCompare(b));
    return {
      load: rows.map(([t, row]) => ({ label: label(t), cpu: row.cpu / row.count, ram: row.ram / row.count })),
      // Fleet total, in Mb/s.
      traffic: rows.map(([t, row]) => ({ label: label(t), rx: (row.rx * 8) / 1e6, tx: (row.tx * 8) / 1e6 })),
    };
  }, [series, range]);

  const storageSlices = nodes
    .filter((node) => node.storage.totalUsedGb > 0)
    .map((node) => ({ name: node.name, value: node.storage.totalUsedGb, capacityGb: node.storage.totalCapacityGb, usageRatio: node.storage.usageRatio }));

  const sortedNodes = useMemo(
    () => [...nodes].sort((a, b) => Number(a.status === 'online') - Number(b.status === 'online') || b.metrics.cpu - a.metrics.cpu),
    [nodes],
  );

  const linkPercent = network && network.total > 0 ? Math.round((network.healthy / network.total) * 100) : null;
  const hour = new Date().getHours();
  const greeting = hour < 6 ? 'Bonne nuit' : hour < 18 ? 'Bonjour' : 'Bonsoir';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vue d’ensemble"
        description={`${greeting}. Voici l’état de votre flotte en direct : ce qui demande votre attention, la charge et l’activité récente.`}
        meta={
          nodes.length > 0 && (
            <StatusPill tone={issues.some((issue) => issue.tone === 'danger') ? 'danger' : issues.length > 0 ? 'warn' : 'ok'}>
              {issues.length === 0 ? 'Flotte nominale' : `${issues.length} point${issues.length > 1 ? 's' : ''} d’attention`}
            </StatusPill>
          )
        }
      />

      <HealthBanner issues={issues} loading={nodesLoading || alertsLoading} />

      {nodesLoading ? (
        <StatRow className="xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <StatCardSkeleton key={index} />
          ))}
        </StatRow>
      ) : (
        <StatRow className="animate-fade-in sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <Stat
            label="Nœuds en ligne"
            value={online.length}
            unit={`/ ${nodes.length}`}
            icon={Server}
            tone={offline.length > 0 ? 'danger' : degraded.length > 0 ? 'warn' : 'ok'}
            hint={offline.length + degraded.length > 0 ? `${offline.length} hors ligne · ${degraded.length} dégradé(s)` : 'Tous les agents répondent'}
          />
          <Stat
            label="Processeurs"
            value={capacity.threads > 0 ? capacity.threads : Math.round(avgCpu)}
            unit={capacity.threads > 0 ? 'threads' : '%'}
            icon={Cpu}
            tone={avgCpu >= 85 ? 'danger' : avgCpu >= 65 ? 'warn' : 'neutral'}
            hint={`${Math.round(avgCpu)} % utilisés en moyenne`}
          />
          <Stat
            label="Mémoire"
            value={capacity.memTotal > 0 ? formatBytes(capacity.memTotal).split(' ')[0] : Math.round(avg((node) => node.metrics.ram))}
            unit={capacity.memTotal > 0 ? formatBytes(capacity.memTotal).split(' ')[1] : '%'}
            icon={MemoryStick}
            tone={capacity.memTotal > 0 && capacity.memUsed / capacity.memTotal >= 0.85 ? 'danger' : 'neutral'}
            hint={capacity.memTotal > 0 ? `${formatBytes(capacity.memUsed)} utilisés (${Math.round((capacity.memUsed / capacity.memTotal) * 100)} %)` : 'Mettez à jour les agents pour la capacité'}
          />
          <Stat
            label="Stockage"
            value={storageUsed.value}
            unit={storageUsed.unit}
            icon={HardDrive}
            tone={storageRatio >= 85 ? 'danger' : storageRatio >= 70 ? 'warn' : 'neutral'}
            hint={`${Math.round(storageRatio)} % de ${formatCapacity(storageTotalGb)}`}
          />
          <Stat
            label="Réseau privé"
            value={linkPercent ?? '—'}
            unit={linkPercent !== null ? '%' : undefined}
            icon={Network}
            tone={linkPercent === null ? 'neutral' : linkPercent >= 99 ? 'ok' : linkPercent >= 80 ? 'warn' : 'danger'}
            hint={network ? `${network.healthy} lien${network.healthy > 1 ? 's' : ''} sain${network.healthy > 1 ? 's' : ''} sur ${network.total}` : 'Pas encore de réseau'}
          />
        </StatRow>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <SectionCard
          icon={Activity}
          title="Charge de la flotte"
          description="Moyenne CPU et RAM de tous les nœuds joignables."
          className="xl:col-span-2"
          actions={
            <Tabs value={range} onValueChange={(value) => setRange(value as Range)}>
              <TabsList variant="segmented">
                {(Object.keys(RANGE_LABEL) as Range[]).map((key) => (
                  <TabsTrigger key={key} value={key}>
                    {RANGE_LABEL[key]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          }
          href={`${base}/infrastructure`}
          linkLabel="Détail par nœud"
        >
          {seriesLoading && !series ? <ChartCardSkeleton height="h-56" /> : <FleetPerformanceChart data={chart.load} />}
        </SectionCard>

        <SectionCard icon={Bell} title="Alertes à traiter" href={`${base}/alerts`} flush>
          {alertsLoading ? (
            <div className="p-4">
              <ListSkeleton rows={4} />
            </div>
          ) : distinctOpen.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-12 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[hsl(var(--ok))]/10">
                <ShieldCheck className="h-5 w-5 text-[hsl(var(--ok))]" />
              </span>
              <p className="text-sm font-medium text-foreground">Aucune alerte en cours</p>
              <p className="text-xs text-muted-foreground">Les nouvelles alertes apparaîtront ici.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border/70">
              {distinctOpen.slice(0, 6).map((alert) => {
                const severity = describe(SEVERITY, alert.severity);
                const index = alert.message.indexOf(' : ');
                const title = index > 0 && index <= 48 ? alert.message.slice(0, index) : alert.message;
                const detail = index > 0 && index <= 48 ? alert.message.slice(index + 3) : null;
                return (
                  <li key={alert.id}>
                    <Link href={`${base}/alerts`} className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2/50 lg:px-5">
                      <StatusDot tone={severity.tone} className="mt-1.5" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-foreground">{title}</span>
                        <span className="block truncate text-2xs text-muted-foreground">
                          {severity.label} · {formatRelative(alert.triggeredAt)}
                          {detail ? ` · ${detail}` : ''}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <SectionCard icon={Server} title="Nœuds" href={`${base}/infrastructure`} linkLabel="Gérer les nœuds" className="xl:col-span-2" flush>
          {nodesLoading ? (
            <div className="p-4">
              <ListSkeleton rows={5} />
            </div>
          ) : nodes.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-muted-foreground">Aucun nœud pour l’instant. Ajoutez-en un depuis la page Nœuds.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-2xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2 font-medium lg:px-5">Nœud</th>
                    <th className="px-3 py-2 font-medium">CPU</th>
                    <th className="px-3 py-2 font-medium">Mémoire</th>
                    <th className="px-3 py-2 font-medium">Stockage</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {sortedNodes.slice(0, 8).map((node) => {
                    const status = describe(NODE_STATUS, node.status);
                    const isOffline = node.status === 'offline';
                    const memory = memoryUsage(node.systemInfo, node.metrics.ram);
                    return (
                      <tr key={node.id} className={cn('group border-b border-border/60 last:border-0', isOffline && 'opacity-60')}>
                        <td className="px-4 py-2.5 lg:px-5">
                          <Link href={`${base}/infrastructure`} className="flex items-center gap-2">
                            <StatusDot tone={status.tone} pulse={node.status === 'online'} />
                            <span className="truncate font-medium text-foreground group-hover:text-primary" title={node.name}>
                              {node.locationCountryCode ? `${flagFromCountryCode(node.locationCountryCode)} ` : ''}
                              {shortHostname(node.name)}
                            </span>
                          </Link>
                          <p className="pl-4 text-2xs text-muted-foreground">
                            {isOffline ? `Hors ligne · vu ${formatRelative(node.lastSeenAt)}` : [node.locationCity, node.systemInfo?.os].filter(Boolean).join(' · ') || node.role}
                          </p>
                        </td>
                        <td className="px-3 py-2.5">
                          {isOffline ? (
                            <span className="text-2xs text-muted-foreground">—</span>
                          ) : (
                            <>
                              <MiniMeter value={node.metrics.cpu} className="w-28" />
                              {cpuShape(node.systemInfo) && <span className="mt-0.5 block text-2xs text-muted-foreground">{cpuShape(node.systemInfo)}</span>}
                            </>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {isOffline ? (
                            <span className="text-2xs text-muted-foreground">—</span>
                          ) : (
                            <>
                              <MiniMeter value={node.metrics.ram} className="w-28" />
                              {memory && <span className="mt-0.5 block whitespace-nowrap text-2xs tabular-nums text-muted-foreground">{memory.label}</span>}
                              <SwapLine info={node.systemInfo} className="mt-0.5" />
                            </>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <MiniMeter value={node.storage.usageRatio * 100} className="w-28" />
                          <span className="mt-0.5 block whitespace-nowrap text-2xs tabular-nums text-muted-foreground">
                            {formatCapacity(node.storage.totalUsedGb)} / {formatCapacity(node.storage.totalCapacityGb)}
                          </span>
                        </td>
                        <td className="pr-3">
                          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {nodes.length > 8 && (
                <Link href={`${base}/infrastructure`} className="block border-t border-border px-4 py-2 text-center text-2xs text-muted-foreground hover:text-foreground">
                  Voir les {nodes.length - 8} autres nœuds
                </Link>
              )}
            </div>
          )}
        </SectionCard>

        <SectionCard icon={ShieldCheck} title="Services" flush>
          <div className="divide-y divide-border/70">
            <ServiceRow
              icon={Network}
              name="Réseau privé"
              href={`${base}/network`}
              tone={!network ? 'neutral' : network.offline > 0 ? 'danger' : network.degraded > 0 ? 'warn' : 'ok'}
              status={!network ? 'Inactif' : network.offline > 0 ? `${network.offline} hors ligne` : network.degraded > 0 ? 'Dégradé' : 'Sain'}
              detail={network ? `${network.total} liens WireGuard entre ${nodes.length} nœuds` : 'Se crée au premier agent connecté'}
            />
            <ServiceRow
              icon={Globe}
              name="DNS interne"
              href={`${base}/infrastructure`}
              tone={!internalDns?.internalDnsNodeId ? 'neutral' : internalDns.internalDnsStatus === 'error' || dnsUnreachable.length > 0 ? 'danger' : internalDns.internalDnsStatus === 'active' ? 'ok' : 'warn'}
              status={
                !internalDns?.internalDnsNodeId
                  ? 'Non configuré'
                  : internalDns.internalDnsStatus === 'error'
                    ? 'En échec'
                    : dnsUnreachable.length > 0
                      ? 'Injoignable'
                      : internalDns.internalDnsStatus === 'active'
                        ? 'Actif'
                        : 'Installation…'
              }
              detail={dnsNode ? `*.tarmac.local servi par ${shortHostname(dnsNode.name)} · ${internalDns?.records.length ?? 0} noms` : 'Résolution des nœuds par leur nom'}
            />
            <ServiceRow
              icon={KeyRound}
              name="Accès VPN"
              href={`${base}/vpn`}
              tone={vpnErrors > 0 ? 'danger' : vpnConnected > 0 ? 'ok' : 'neutral'}
              status={vpnErrors > 0 ? `${vpnErrors} en erreur` : `${vpnConnected} connecté${vpnConnected > 1 ? 's' : ''}`}
              detail={`${vpnLive.length} profil${vpnLive.length > 1 ? 's' : ''} actif${vpnLive.length > 1 ? 's' : ''}`}
            />
            <ServiceRow
              icon={RefreshCcw}
              name="Réplications"
              href={`${base}/replication`}
              tone={failedJobs.length > 0 ? 'danger' : runningJobs.length > 0 ? 'info' : syncJobs.length > 0 ? 'ok' : 'neutral'}
              status={failedJobs.length > 0 ? `${failedJobs.length} en échec` : runningJobs.length > 0 ? `${runningJobs.length} en cours` : syncJobs.length > 0 ? 'À jour' : 'Aucune'}
              detail={syncJobs.length > 0 ? `${syncJobs.length} tâche${syncJobs.length > 1 ? 's' : ''} · dernière ${formatRelative(syncJobs.map((job) => job.lastRunAt).filter(Boolean).sort().pop() ?? null)}` : 'Synchronisations rsync planifiées'}
            />
            <ServiceRow
              icon={ArrowRightLeft}
              name="Migrations"
              href={`${base}/migrations`}
              tone={failedMigrations.length > 0 ? 'danger' : activeMigrations.length > 0 ? 'info' : 'neutral'}
              status={failedMigrations.length > 0 ? `${failedMigrations.length} en échec` : activeMigrations.length > 0 ? `${activeMigrations.length} en cours` : 'Aucune en cours'}
              detail={activeMigrations[0] ? `${activeMigrations[0].name} · ${activeMigrations[0].progress} %` : 'Transferts de données entre nœuds'}
            />
          </div>
          {activeMigrations[0] && (
            <div className="border-t border-border px-4 pb-3 pt-1 lg:px-5">
              <Progress value={activeMigrations[0].progress} className="h-1" />
            </div>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <SectionCard icon={HardDrive} title="Stockage" description="Volume occupé par nœud et taux de remplissage." href={`${base}/storage`}>
          <StorageBreakdownChart data={storageSlices} stacked />
        </SectionCard>
        <SectionCard icon={Activity} title="Trafic de la flotte" description={`Total entrant et sortant, sur ${RANGE_LABEL[range]}.`}>
          {seriesLoading && !series ? <ChartCardSkeleton height="h-56" /> : <NetworkThroughputChart data={chart.traffic} />}
        </SectionCard>
        <SectionCard icon={History} title="Activité récente" href={`${base}/logs`} linkLabel="Journal" flush>
          {!audit ? (
            <div className="p-4">
              <ListSkeleton rows={4} />
            </div>
          ) : audit.items.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-muted-foreground">Aucune action récente.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {audit.items.map((entry) => (
                <ActivityLine key={entry.id} entry={entry} refs={audit.refs ?? {}} />
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {!nodesLoading && issues.length === 0 && nodes.length > 0 && (
        <p className="flex items-center justify-center gap-1.5 pb-2 text-2xs text-muted-foreground">
          <CheckCircle2 className="h-3 w-3 text-[hsl(var(--ok))]" />
          Mis à jour en direct · {online.length} agent{online.length > 1 ? 's' : ''} connecté{online.length > 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
}
