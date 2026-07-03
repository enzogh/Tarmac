'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Gauge,
  Network,
  Play,
  RadioTower,
  RefreshCw,
  Waves,
} from 'lucide-react';
import { api, VlanConnection, VlanConnectionTest, VlanStatus } from '@/lib/api';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type TestType = 'ping' | 'connectivity' | 'latency';
type LinkStatus = 'healthy' | 'degraded' | 'offline' | 'unknown';

type GraphNode = {
  id: string;
  label: string;
  vlanIp: string;
  status: 'online' | 'offline' | 'degraded';
  x: number;
  y: number;
};

type GraphLink = {
  sourceNodeId: string;
  targetNodeId: string;
  status: LinkStatus;
  latencyMs?: number | null;
  packetLoss?: number | null;
  bandwidth?: number | null;
};

const TEST_OPTIONS: Array<{ value: TestType; label: string }> = [
  { value: 'ping', label: 'Ping' },
  { value: 'connectivity', label: 'Connectivité' },
  { value: 'latency', label: 'Latence' },
];

const STATUS_PRIORITY: Record<LinkStatus, number> = {
  healthy: 0,
  unknown: 1,
  degraded: 2,
  offline: 3,
};

const formatLatency = (value?: number | null) =>
  typeof value === 'number' ? `${value} ms` : '—';

const formatLoss = (value?: number | null) =>
  typeof value === 'number' ? `${value} %` : '—';

const formatBandwidth = (value?: number | null) =>
  typeof value === 'number' ? `${value} Mbps` : '—';

const isTestType = (value: string): value is TestType =>
  value === 'ping' || value === 'connectivity' || value === 'latency';

const getConnectionBadgeVariant = (status: VlanConnection['status']) => {
  if (status === 'healthy') return 'success';
  if (status === 'degraded') return 'warning';
  return 'destructive';
};

const getConnectionLabel = (status: VlanConnection['status']) => {
  if (status === 'healthy') return 'Healthy';
  if (status === 'degraded') return 'Degraded';
  if (status === 'offline') return 'Offline';
  return 'Unknown';
};

const linkStroke = (status: LinkStatus) => {
  if (status === 'healthy') return 'rgba(52,211,153,0.8)';
  if (status === 'degraded') return 'rgba(251,191,36,0.85)';
  if (status === 'offline') return 'rgba(251,113,133,0.8)';
  return 'rgba(161,161,170,0.65)';
};

const nodeFill = (status: GraphNode['status']) => {
  if (status === 'online') return '#10b981';
  if (status === 'degraded') return '#f59e0b';
  return '#f43f5e';
};

export default function NetworkPage() {
  const token = useMemo(
    () => (typeof window !== 'undefined' ? localStorage.getItem('tarmac_token') : null),
    [],
  );

  const [vlanStatus, setVlanStatus] = useState<VlanStatus | null>(null);
  const [connections, setConnections] = useState<VlanConnection[]>([]);
  const [tests, setTests] = useState<VlanConnectionTest[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null);
  const inFlightRef = useRef(false);
  const [testRunning, setTestRunning] = useState(false);
  const [selectedTest, setSelectedTest] = useState<{
    from?: string;
    to?: string;
    type?: TestType;
  }>({});

  useEffect(() => {
    const fetchData = async (isInitial: boolean) => {
      if (!token || inFlightRef.current) return;
      inFlightRef.current = true;
      if (isInitial) {
        setInitialLoading(true);
      } else {
        setRefreshing(true);
      }

      try {
        const vlans = await api.vlan.getAll(token);
        if (vlans.vlans.length > 0) {
          const vlanId = vlans.vlans[0].id;
          const [status, conns, testsList] = await Promise.all([
            api.vlan.getStatus(token, vlanId),
            api.vlan.getConnections(token, vlanId),
            api.vlan.getTests(token, vlanId),
          ]);
          setVlanStatus(status);
          setConnections(conns.connections);
          setTests(testsList.tests);
          setLastRefreshAt(new Date());
        } else {
          setVlanStatus(null);
          setConnections([]);
          setTests([]);
          setLastRefreshAt(new Date());
        }
      } catch (error) {
        console.error('Failed to fetch VLAN data:', error);
      } finally {
        if (isInitial) {
          setInitialLoading(false);
        } else {
          setRefreshing(false);
        }
        inFlightRef.current = false;
      }
    };

    void fetchData(true);
    const interval = setInterval(() => {
      void fetchData(false);
    }, 5000);
    return () => clearInterval(interval);
  }, [token]);

  const graph = useMemo(() => {
    if (!vlanStatus?.vlan.members?.length) {
      return { nodes: [] as GraphNode[], links: [] as GraphLink[] };
    }

    const nodes = vlanStatus.vlan.members.map((member, index, all) => {
      const angle = (index / Math.max(all.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const radius = all.length <= 3 ? 135 : 175;
      const centerX = 500;
      const centerY = 250;
      return {
        id: member.nodeId,
        label: member.node?.name || member.nodeId.slice(0, 8),
        vlanIp: member.vlanIp,
        status: member.node?.status === 'online' ? 'online' : 'offline',
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      } satisfies GraphNode;
    });

    const bestByPair = new Map<string, GraphLink>();
    for (const connection of connections) {
      const pair = [connection.sourceNodeId, connection.targetNodeId].sort().join('__');
      const previous = bestByPair.get(pair);
      if (!previous || STATUS_PRIORITY[connection.status] > STATUS_PRIORITY[previous.status]) {
        bestByPair.set(pair, {
          sourceNodeId: connection.sourceNodeId,
          targetNodeId: connection.targetNodeId,
          status: connection.status,
          latencyMs: connection.latencyMs,
          packetLoss: connection.packetLoss,
          bandwidth: connection.bandwidth,
        });
      }
    }

    return {
      nodes,
      links: Array.from(bestByPair.values()),
    };
  }, [connections, vlanStatus]);

  const nodeById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const connectionByDirection = useMemo(
    () => new Map(connections.map((connection) => [`${connection.sourceNodeId}__${connection.targetNodeId}`, connection])),
    [connections],
  );
  const memberByNodeId = useMemo(
    () => new Map((vlanStatus?.vlan.members || []).map((member) => [member.nodeId, member])),
    [vlanStatus],
  );

  const handleRunTest = async () => {
    if (!token || !vlanStatus || !selectedTest.from || !selectedTest.to || !selectedTest.type) {
      alert('Veuillez sélectionner les paramètres du test');
      return;
    }

    try {
      setTestRunning(true);
      const result = await api.vlan.runTest(
        token,
        vlanStatus.vlan.id,
        selectedTest.from,
        selectedTest.to,
        selectedTest.type,
      );
      setTests((prev) => [result.test, ...prev]);
    } catch (error) {
      console.error('Test failed:', error);
      alert('Le test de connectivité a échoué');
    } finally {
      setTestRunning(false);
    }
  };

  const content = initialLoading ? (
    <div className="flex h-96 items-center justify-center">
      <p className="text-muted-foreground">Chargement du réseau...</p>
    </div>
  ) : !vlanStatus ? (
    <Card className="border-dashed border-white/10 bg-zinc-900/60 backdrop-blur">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <AlertTriangle className="h-8 w-8 text-violet-400" />
        <h3 className="text-xl font-semibold text-foreground">Aucun réseau VLAN trouvé</h3>
        <p className="max-w-md text-sm text-muted-foreground">
          Déployez des agents pour initialiser le VLAN. Les liens et télémétries apparaîtront automatiquement.
        </p>
      </CardContent>
    </Card>
  ) : (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-500/20 bg-violet-500/[0.07] px-4 py-3">
        <p className="text-sm text-violet-200/90">
          Monitoring asynchrone : mise à jour silencieuse toutes les 5 secondes, sans réactualiser la page.
        </p>
        <div className="flex items-center gap-2 text-xs text-violet-200/80">
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          {lastRefreshAt
            ? `Dernière sync ${lastRefreshAt.toLocaleTimeString('fr-FR')}`
            : 'Sync en attente'}
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.08] bg-zinc-900/55 px-4 py-3 text-xs text-muted-foreground">
        Les métriques de lien sont remontées par les agents via WireGuard (handshake + trafic) avec sondes
        ping pair-à-pair. Un fallback estimatif côté API reste actif si un agent ne publie pas encore ces données.
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-white/[0.08] bg-zinc-900/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Nœuds actifs
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-end justify-between">
            <p className="text-3xl font-semibold text-foreground">{vlanStatus.memberCount}</p>
            <Network className="h-5 w-5 text-violet-400" />
          </CardContent>
        </Card>

        <Card className="border-white/[0.08] bg-zinc-900/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Liens sains
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-end justify-between">
            <p className="text-3xl font-semibold text-emerald-300">
              {vlanStatus.connectionStats.total > 0
                ? Math.round((vlanStatus.connectionStats.healthy / vlanStatus.connectionStats.total) * 100)
                : 100}
              %
            </p>
            <RadioTower className="h-5 w-5 text-emerald-400" />
          </CardContent>
        </Card>

        <Card className="border-white/[0.08] bg-zinc-900/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Liens dégradés
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-end justify-between">
            <p className="text-3xl font-semibold text-amber-300">{vlanStatus.connectionStats.degraded}</p>
            <Gauge className="h-5 w-5 text-amber-400" />
          </CardContent>
        </Card>

        <Card className="border-white/[0.08] bg-zinc-900/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Liens offline
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-end justify-between">
            <p className="text-3xl font-semibold text-rose-300">{vlanStatus.connectionStats.offline}</p>
            <Activity className="h-5 w-5 text-rose-400" />
          </CardContent>
        </Card>
      </div>

      <Card className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
        <CardHeader>
          <CardTitle className="text-base">Vue interconnexion (mind map)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border border-white/[0.08] bg-zinc-950/50 p-4">
            <svg viewBox="0 0 1000 520" className="h-[420px] w-full">
              {graph.links.map((link) => {
                const source = nodeById.get(link.sourceNodeId);
                const target = nodeById.get(link.targetNodeId);
                if (!source || !target) return null;
                return (
                  <g key={`${link.sourceNodeId}-${link.targetNodeId}`}>
                    <line
                      x1={source.x}
                      y1={source.y}
                      x2={target.x}
                      y2={target.y}
                      stroke={linkStroke(link.status)}
                      strokeWidth={link.status === 'offline' ? 2 : 3}
                      strokeDasharray={link.status === 'offline' ? '6 6' : undefined}
                    />
                    <title>
                      {source.label} ↔ {target.label} · {getConnectionLabel(link.status)} ·{' '}
                      {source.vlanIp} ↔ {target.vlanIp} ·{' '}
                      {formatLatency(link.latencyMs)} · {formatLoss(link.packetLoss)} ·{' '}
                      {formatBandwidth(link.bandwidth)}
                    </title>
                  </g>
                );
              })}

              {graph.nodes.map((node) => (
                <g key={node.id}>
                  <circle cx={node.x} cy={node.y} r={26} fill="rgba(9,9,11,0.95)" stroke={nodeFill(node.status)} strokeWidth={2.5} />
                  <circle cx={node.x} cy={node.y} r={10} fill={nodeFill(node.status)} />
                  <text
                    x={node.x}
                    y={node.y + 48}
                    textAnchor="middle"
                    fill="rgba(244,244,245,0.94)"
                    fontSize={13}
                    fontFamily="ui-sans-serif, system-ui, sans-serif"
                  >
                    {node.label}
                  </text>
                  <text
                    x={node.x}
                    y={node.y + 65}
                    textAnchor="middle"
                    fill="rgba(161,161,170,0.95)"
                    fontSize={11}
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  >
                    {node.vlanIp}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        </CardContent>
      </Card>

      <Card className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
        <CardHeader>
          <CardTitle className="text-base">Matrice de connexion</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>IP VLAN source</TableHead>
                <TableHead>IP VLAN cible</TableHead>
                <TableHead className="text-center">Statut</TableHead>
                <TableHead className="text-right">Latence</TableHead>
                <TableHead className="text-right">Loss</TableHead>
                <TableHead className="text-right">Débit sortant</TableHead>
                <TableHead className="text-right">Débit entrant</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {connections.map((conn) => {
                const reverse = connectionByDirection.get(`${conn.targetNodeId}__${conn.sourceNodeId}`);
                return (
                  <TableRow key={conn.id}>
                    <TableCell className="max-w-[280px] truncate font-mono text-xs">
                      <div>{conn.sourceNode?.vlanIp || '—'}</div>
                      <div className="text-[10px] text-muted-foreground">{conn.sourceNodeId.slice(0, 8)}</div>
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate font-mono text-xs">
                      <div>{conn.targetNode?.vlanIp || '—'}</div>
                      <div className="text-[10px] text-muted-foreground">{conn.targetNodeId.slice(0, 8)}</div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={getConnectionBadgeVariant(conn.status)}>{getConnectionLabel(conn.status)}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatLatency(conn.latencyMs)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatLoss(conn.packetLoss)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatBandwidth(conn.bandwidth)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatBandwidth(reverse?.bandwidth)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
        <CardHeader>
          <CardTitle className="text-base">Tests de connectivité</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Depuis</p>
              <Select
                value={selectedTest.from}
                onValueChange={(value) => setSelectedTest((prev) => ({ ...prev, from: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner" />
                </SelectTrigger>
                <SelectContent>
                  {(vlanStatus.vlan.members || []).map((m) => (
                    <SelectItem key={m.id} value={m.nodeId}>
                      {(m.node?.name || m.nodeId) + ` (${m.vlanIp})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <p className="mb-1 text-xs text-muted-foreground">Vers</p>
              <Select
                value={selectedTest.to}
                onValueChange={(value) => setSelectedTest((prev) => ({ ...prev, to: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner" />
                </SelectTrigger>
                <SelectContent>
                  {(vlanStatus.vlan.members || [])
                    .filter((m) => m.nodeId !== selectedTest.from)
                    .map((m) => (
                      <SelectItem key={m.id} value={m.nodeId}>
                        {(m.node?.name || m.nodeId) + ` (${m.vlanIp})`}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <p className="mb-1 text-xs text-muted-foreground">Type</p>
              <Select
                value={selectedTest.type}
                onValueChange={(value) => {
                  if (isTestType(value)) {
                    setSelectedTest((prev) => ({ ...prev, type: value }));
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionner" />
                </SelectTrigger>
                <SelectContent>
                  {TEST_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            onClick={handleRunTest}
            disabled={testRunning}
            className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500"
          >
            <Play className="mr-2 h-4 w-4" />
            {testRunning ? 'Test en cours...' : 'Exécuter le test'}
          </Button>

          {tests.length > 0 && (
            <div className="space-y-2">
              {tests.slice(0, 5).map((test) => (
                <div
                  key={test.id}
                  className="flex items-start justify-between rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3"
                >
                  <div className="space-y-1">
                    <p className="font-mono text-xs text-foreground">
                      {(memberByNodeId.get(test.initiatorNodeId)?.vlanIp || test.initiatorNodeId.slice(0, 8))} →{' '}
                      {(memberByNodeId.get(test.targetNodeId)?.vlanIp || test.targetNodeId.slice(0, 8))}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatLatency(test.latencyMs)} · {formatLoss(test.packetLoss)}
                    </p>
                  </div>
                  <Badge variant={test.status === 'success' ? 'success' : 'destructive'}>
                    <Waves className="mr-1 h-3 w-3" />
                    {test.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Réseau VLAN</h1>
          <p className="text-sm text-muted-foreground">
            Supervision premium des liens inter-nœuds : statut, latence, perte et débit en temps réel.
          </p>
        </div>

        {content}
      </div>
    </DashboardLayout>
  );
}
