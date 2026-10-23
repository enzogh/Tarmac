'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import dynamic from 'next/dynamic';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Gauge,
  Globe2,
  Info,
  Network,
  Play,
  RadioTower,
  RefreshCw,
  Share2,
  Waves,
  Zap,
} from 'lucide-react';
import { api, VlanConnection, VlanConnectionHistory, VlanConnectionTest, VlanStatus } from '@/lib/api';
import { ConnectionHistoryChart } from '@/components/dashboard-charts';
import { GeoInfo, flagFromCountryCode, geocodeCity, getGeoInfo, normalizeCountryCode, parseHostFromEndpoint } from '@/lib/geo';
import { countryCentroid } from '@/lib/country-centroids';
import { readNodeLabels } from '../../../../lib/node-labels';
import { PageHeader } from '../../../../components/PageHeader';
import { AnimatedGradientText } from '../../../../components/ui/animated-gradient-text';
import { SectionLabel } from '../../../../components/SectionLabel';
import { Callout } from '../../../../components/Callout';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../components/ui/tooltip';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge, StatCard } from '@/components/ui';
import { ChartCardSkeleton, StatCardSkeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { WorldMapLink, WorldMapNode } from '@/components/WorldMap';

const WorldMap = dynamic(() => import('@/components/WorldMap').then((mod) => mod.WorldMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-[560px] items-center justify-center rounded-xl border border-border bg-surface-2 text-sm text-muted-foreground">
      Chargement de la carte…
    </div>
  ),
});

type TestType = 'ping' | 'traceroute';
type LinkStatus = 'healthy' | 'degraded' | 'offline' | 'unknown';

type GraphNode = {
  id: string;
  label: string;
  vlanIp: string;
  status: 'online' | 'offline' | 'degraded';
  city: string;
  country: string;
  countryCode: string | null;
  x: number;
  y: number;
  lat: number;
  lng: number;
  isPositionApproximate: boolean;
};

type GraphBubble = {
  id: string;
  label: string;
  x: number;
  y: number;
  r: number;
};

type GraphLink = {
  key: string;
  sourceNodeId: string;
  targetNodeId: string;
  status: LinkStatus;
  latencyMs?: number | null;
  packetLoss?: number | null;
  bandwidth?: number | null;
  trafficScore: number;
};

type DirectedFlow = {
  key: string;
  sourceNodeId: string;
  targetNodeId: string;
  status: LinkStatus;
  latencyMs?: number | null;
  packetLoss?: number | null;
  bandwidth?: number | null;
  trafficScore: number;
};

type GeoOverride = {
  city?: string;
  country?: string;
  countryCode?: string;
};

const MIND_MAP_WIDTH = 1320;
const MIND_MAP_HEIGHT = 760;

const TEST_OPTIONS: Array<{ value: TestType; label: string }> = [
  { value: 'ping', label: 'Ping' },
  { value: 'traceroute', label: 'Traceroute' },
];

const testStatusLabel: Record<VlanConnectionTest['status'], string> = {
  pending: 'En attente',
  success: 'Réussi',
  failed: 'Échoué',
  timeout: 'Délai dépassé',
};

const REGION_LABELS: Record<string, string> = {
  europe: 'Europe',
  'north-america': 'Amérique du Nord',
  'south-america': 'Amérique du Sud',
  asia: 'Asie',
  oceania: 'Océanie',
  africa: 'Afrique',
};

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
  typeof value === 'number' ? `${value} MB/s` : '—';

const HISTORY_RANGE_LABELS: Record<'1h' | '24h' | '7d', string> = {
  '1h': '1 heure',
  '24h': '24 heures',
  '7d': '7 jours',
};

const uptimeToneClass = (percent: number) => {
  if (percent >= 99) return 'text-emerald-400';
  if (percent >= 90) return 'text-amber-400';
  return 'text-rose-400';
};

const isTestType = (value: string): value is TestType => value === 'ping' || value === 'traceroute';

const getConnectionBadgeVariant = (status: VlanConnection['status']): 'success' | 'warning' | 'error' | 'info' => {
  if (status === 'healthy') return 'success';
  if (status === 'degraded') return 'warning';
  return 'error';
};

const getConnectionLabel = (status: VlanConnection['status']) => {
  if (status === 'healthy') return 'Sain';
  if (status === 'degraded') return 'Dégradé';
  if (status === 'offline') return 'Hors ligne';
  return 'Inconnu';
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

const linkPulseDuration = (latencyMs?: number | null) => {
  if (typeof latencyMs !== 'number' || latencyMs <= 0) return '3s';
  const clamped = Math.max(900, Math.min(5000, latencyMs * 18));
  return `${Math.round(clamped)}ms`;
};

const linkGlow = (status: LinkStatus) => {
  if (status === 'healthy') return 'drop-shadow(0 0 9px rgba(16,185,129,0.6))';
  if (status === 'degraded') return 'drop-shadow(0 0 9px rgba(245,158,11,0.55))';
  if (status === 'offline') return 'drop-shadow(0 0 9px rgba(244,63,94,0.5))';
  return 'drop-shadow(0 0 7px rgba(161,161,170,0.45))';
};

const matrixCellTone = (status?: VlanConnection['status']) => {
  if (status === 'healthy') return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100';
  if (status === 'degraded') return 'border-amber-400/30 bg-amber-500/10 text-amber-100';
  if (status === 'offline') return 'border-rose-400/30 bg-rose-500/10 text-rose-100';
  return 'border-border bg-zinc-900/60 text-muted-foreground';
};

const clampScale = (value: number) => Math.max(0.45, Math.min(3.2, value));
const NODE_RADIUS = 26;

export default function NetworkPage() {
  const [vlanStatus, setVlanStatus] = useState<VlanStatus | null>(null);
  const [connections, setConnections] = useState<VlanConnection[]>([]);
  const [tests, setTests] = useState<VlanConnectionTest[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null);
  const inFlightRef = useRef(false);
  const [testRunning, setTestRunning] = useState(false);
  const [notice, setNotice] = useState<{ type: 'error' | 'success'; message: string } | null>(null);
  const [selectedPairKey, setSelectedPairKey] = useState<string | null>(null);
  const [selectedFlowKey, setSelectedFlowKey] = useState<string | null>(null);
  const [geoByIp, setGeoByIp] = useState<Record<string, GeoInfo | null>>({});
  const [geoOverrides, setGeoOverrides] = useState<Record<string, GeoOverride>>({});
  const [geoDirtyByNodeId, setGeoDirtyByNodeId] = useState<Record<string, boolean>>({});
  const [geoSavingByNodeId, setGeoSavingByNodeId] = useState<Record<string, boolean>>({});
  const [nodePositionOverrides, setNodePositionOverrides] = useState<Record<string, { x: number; y: number }>>({});
  const [mapLocationOverrides, setMapLocationOverrides] = useState<Record<string, [number, number]>>({});
  const [mapView, setMapView] = useState<'map' | 'graph'>('map');
  const [selectedMapNodeId, setSelectedMapNodeId] = useState<string | null>(null);
  const [viewTransform, setViewTransform] = useState({ scale: 1, tx: 0, ty: 0 });
  const [selectedTest, setSelectedTest] = useState<{
    from?: string;
    to?: string;
    type?: TestType;
  }>({});
  const [nodeLabels, setNodeLabels] = useState<Record<string, string[]>>({});
  const [historyRange, setHistoryRange] = useState<'1h' | '24h' | '7d'>('1h');
  // Opens on the topology, which is what the page is for; the connectivity
  // test form now waits in its own tab instead of greeting every visit.
  const [networkTab, setNetworkTab] = useState('topology');
  const [historyForward, setHistoryForward] = useState<VlanConnectionHistory | null>(null);
  const [historyReverse, setHistoryReverse] = useState<VlanConnectionHistory | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; startTx: number; startTy: number } | null>(null);
  const nodeDragRef = useRef<{ pointerId: number; nodeId: string; offsetX: number; offsetY: number } | null>(null);
  const geocodeAttemptedRef = useRef<Set<string>>(new Set());
  const countryPersistAttemptedRef = useRef<Set<string>>(new Set());
  const [gatewaySavingByNodeId, setGatewaySavingByNodeId] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setNodeLabels(readNodeLabels());
  }, []);




  useEffect(() => {
    const members = vlanStatus?.vlan.members ?? [];
    setGeoOverrides((prev) => {
      const next: Record<string, GeoOverride> = { ...prev };
      const activeNodeIds = new Set<string>();
      for (const member of members) {
        activeNodeIds.add(member.nodeId);
        if (geoDirtyByNodeId[member.nodeId]) continue;
        next[member.nodeId] = {
          city: member.node?.locationCity ?? '',
          country: member.node?.locationCountry ?? '',
          countryCode: normalizeCountryCode(member.node?.locationCountryCode) ?? '',
        };
      }
      for (const nodeId of Object.keys(next)) {
        if (!activeNodeIds.has(nodeId)) {
          delete next[nodeId];
        }
      }
      return next;
    });
  }, [vlanStatus, geoDirtyByNodeId]);

  useEffect(() => {
    const fetchData = async (isInitial: boolean) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      if (isInitial) {
        setInitialLoading(true);
      } else {
        setRefreshing(true);
      }

      try {
        const vlans = await api.vlan.getAll();
        if (vlans.vlans.length > 0) {
          const vlanId = vlans.vlans[0].id;
          const [status, conns, testsList] = await Promise.all([
            api.vlan.getStatus(vlanId),
            api.vlan.getConnections(vlanId),
            api.vlan.getTests(vlanId),
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
    // Skip ticks while the tab is backgrounded — unlike usePolling (SWR, which pauses
    // automatically when hidden), this hand-rolled interval would otherwise keep firing
    // 3 parallel requests every 5s in every idle background tab.
    const interval = setInterval(() => {
      if (document.hidden) return;
      void fetchData(false);
    }, 5000);
    const onVisible = () => {
      if (!document.hidden) void fetchData(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    const members = vlanStatus?.vlan.members ?? [];
    const ips = Array.from(
      new Set(
        members
          .map((member) => parseHostFromEndpoint(member.node?.externalIp || member.node?.overlayEndpoint))
          .filter((value): value is string => Boolean(value)),
      ),
    );
    if (ips.length === 0) return;
    const missing = ips.filter((ip) => !(ip in geoByIp));
    if (missing.length === 0) return;

    let cancelled = false;
    void Promise.all(missing.map((ip) => getGeoInfo(ip))).then((results) => {
      if (cancelled) return;
      setGeoByIp((prev) => {
        const next = { ...prev };
        missing.forEach((ip, index) => {
          next[ip] = results[index];
        });
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [vlanStatus, geoByIp]);

  // A node's country is needed server-side to resolve its VLAN region (for
  // regional gateway segmentation), but geo-IP detection only ever lived in
  // this client's geoByIp cache — never persisted. Silently save the
  // detected country the first time it's known for a node that doesn't have
  // one in the database yet, so region resolution "just works" without the
  // user having to open the manual location panel first.
  useEffect(() => {
    const members = vlanStatus?.vlan.members ?? [];
    const candidates = members.filter((member) => {
      const node = member.node;
      if (!node || node.locationCountryCode) return false;
      if (countryPersistAttemptedRef.current.has(member.nodeId)) return false;
      const endpointHost = parseHostFromEndpoint(node.externalIp || node.overlayEndpoint);
      const geo = endpointHost ? geoByIp[endpointHost] : null;
      return Boolean(geo?.countryCode);
    });
    if (candidates.length === 0) return;
    candidates.forEach((member) => countryPersistAttemptedRef.current.add(member.nodeId));

    let cancelled = false;
    void (async () => {
      for (const member of candidates) {
        const node = member.node;
        const endpointHost = node ? parseHostFromEndpoint(node.externalIp || node.overlayEndpoint) : null;
        const geo = endpointHost ? geoByIp[endpointHost] : null;
        const countryCode = normalizeCountryCode(geo?.countryCode);
        if (cancelled || !countryCode) continue;

        try {
          const updatedNode = await api.nodes.update(member.nodeId, {
            locationCountry: geo?.country ?? null,
            locationCountryCode: countryCode,
          });
          if (cancelled) continue;
          setVlanStatus((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              vlan: {
                ...prev.vlan,
                members: (prev.vlan.members || []).map((m) =>
                  m.nodeId === member.nodeId && m.node
                    ? {
                        ...m,
                        node: {
                          ...m.node,
                          locationCountry: updatedNode.locationCountry ?? null,
                          locationCountryCode: updatedNode.locationCountryCode ?? null,
                        },
                      }
                    : m,
                ),
              },
            };
          });
        } catch (error) {
          console.error('Failed to persist detected country:', error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vlanStatus, geoByIp]);

  // Cities saved before geocoding existed (or entered without ever blurring
  // out of the field again) only ever got a label, never coordinates — they
  // still fall back to the country centroid, which is why "Roubaix" could
  // render nowhere near Roubaix. Resolve any node that has a city but no
  // coordinates yet, once, and persist the result so it sticks.
  useEffect(() => {
    const members = vlanStatus?.vlan.members ?? [];
    const candidates = members.filter((member) => {
      const node = member.node;
      if (!node?.locationCity) return false;
      if (typeof node.locationLat === 'number' && typeof node.locationLng === 'number') return false;
      if (mapLocationOverrides[member.nodeId]) return false;
      if (geocodeAttemptedRef.current.has(member.nodeId)) return false;
      return true;
    });
    if (candidates.length === 0) return;
    // Mark every candidate attempted synchronously, before any await runs —
    // otherwise a second effect run triggered mid-loop (each geocode below
    // updates vlanStatus, which re-triggers this effect) would still see
    // not-yet-reached candidates as fair game and geocode them a second time.
    candidates.forEach((member) => geocodeAttemptedRef.current.add(member.nodeId));

    let cancelled = false;
    void (async () => {
      for (const member of candidates) {
        const node = member.node;
        if (!node?.locationCity) continue;
        const geocoded = await geocodeCity(node.locationCity, node.locationCountry);
        if (cancelled || !geocoded) continue;

        setMapLocationOverrides((prev) => ({ ...prev, [member.nodeId]: [geocoded.lat, geocoded.lng] }));
        setVlanStatus((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            vlan: {
              ...prev.vlan,
              members: (prev.vlan.members || []).map((m) =>
                m.nodeId === member.nodeId && m.node
                  ? { ...m, node: { ...m.node, locationLat: geocoded.lat, locationLng: geocoded.lng } }
                  : m,
              ),
            },
          };
        });

        try {
          await api.nodes.update(member.nodeId, { locationLat: geocoded.lat, locationLng: geocoded.lng });
        } catch (error) {
          console.error('Failed to persist geocoded location:', error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vlanStatus, mapLocationOverrides]);

  // Mirrors AgentsService.reconcileOverlayForVlan's segmentation rule (apps/api/src/agents/agents.service.ts):
  // same-region pairs (or unresolved region) stay full-mesh; cross-region pairs are only
  // physically peered when BOTH regions have a designated gateway, and then only between
  // those two gateway nodes — every other cross-region pair has no direct WireGuard peer at all.
  const gatewayNodeIdByRegion = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of vlanStatus?.vlan.members ?? []) {
      if (member.region && member.node?.overlayIsGateway) {
        map.set(member.region, member.nodeId);
      }
    }
    return map;
  }, [vlanStatus]);
  const regionByNodeId = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const member of vlanStatus?.vlan.members ?? []) {
      map.set(member.nodeId, member.region ?? null);
    }
    return map;
  }, [vlanStatus]);
  const isPhysicalLink = useCallback(
    (aNodeId: string, bNodeId: string) => {
      const regionA = regionByNodeId.get(aNodeId) ?? null;
      const regionB = regionByNodeId.get(bNodeId) ?? null;
      if (!regionA || !regionB || regionA === regionB) return true;
      const gatewayA = gatewayNodeIdByRegion.get(regionA);
      const gatewayB = gatewayNodeIdByRegion.get(regionB);
      if (!gatewayA || !gatewayB) return true;
      return aNodeId === gatewayA && bNodeId === gatewayB;
    },
    [regionByNodeId, gatewayNodeIdByRegion],
  );
  const physicalConnections = useMemo(
    () => connections.filter((connection) => isPhysicalLink(connection.sourceNodeId, connection.targetNodeId)),
    [connections, isPhysicalLink],
  );

  const graph = useMemo(() => {
    if (!vlanStatus?.vlan.members?.length) {
      return { nodes: [] as GraphNode[], links: [] as GraphLink[] };
    }

    const membersList = vlanStatus.vlan.members ?? [];
    const grouped = new Map<string, Map<string, Array<(typeof membersList)[number]>>>();
    for (const member of membersList) {
      const endpointHost = parseHostFromEndpoint(member.node?.externalIp || member.node?.overlayEndpoint);
      const geo = endpointHost ? geoByIp[endpointHost] : null;
      const override = geoOverrides[member.nodeId];
      const country = override?.country?.trim() || geo?.country || 'Pays inconnu';
      const city = override?.city?.trim() || geo?.city || 'Ville inconnue';
      if (!grouped.has(country)) grouped.set(country, new Map());
      const countryGroup = grouped.get(country)!;
      if (!countryGroup.has(city)) countryGroup.set(city, []);
      countryGroup.get(city)!.push(member);
    }

    const countryEntries = Array.from(grouped.entries());
    const centerX = MIND_MAP_WIDTH / 2;
    const centerY = MIND_MAP_HEIGHT / 2;
    const countryOrbitRadius =
      countryEntries.length <= 1
        ? 0
        : countryEntries.length === 2
          ? 220
          : Math.min(360, 170 + countryEntries.length * 42);
    const nodes: GraphNode[] = [];

    countryEntries.forEach(([country, cities], countryIndex) => {
      const countryAngle = (countryIndex / Math.max(countryEntries.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const countryCenterX = centerX + Math.cos(countryAngle) * countryOrbitRadius;
      const countryCenterY = centerY + Math.sin(countryAngle) * countryOrbitRadius;
      const cityEntries = Array.from(cities.entries());
      cityEntries.forEach(([city, members], cityIndex) => {
        const cityAngle = (cityIndex / Math.max(cityEntries.length, 1)) * Math.PI * 2 - Math.PI / 2;
        const cityOrbitRadius =
          cityEntries.length <= 1
            ? 0
            : Math.min(220, 90 + members.length * 22 + Math.max(0, cityEntries.length - 2) * 18);
        const cityCenterX = countryCenterX + Math.cos(cityAngle) * cityOrbitRadius;
        const cityCenterY = countryCenterY + Math.sin(cityAngle) * cityOrbitRadius;
        members.forEach((member, memberIndex) => {
          const endpointHost = parseHostFromEndpoint(member.node?.externalIp || member.node?.overlayEndpoint);
          const geo = endpointHost ? geoByIp[endpointHost] : null;
          const override = geoOverrides[member.nodeId];
          const nodeAngle = (memberIndex / Math.max(members.length, 1)) * Math.PI * 2 - Math.PI / 2;
          const nodeOrbitRadius = members.length <= 1 ? 0 : Math.min(220, 58 + members.length * 14);
          const countryCode = normalizeCountryCode(override?.countryCode) ?? geo?.countryCode ?? null;
          const mapOverride = mapLocationOverrides[member.nodeId];
          let lat: number;
          let lng: number;
          let isPositionApproximate: boolean;
          if (mapOverride) {
            [lat, lng] = mapOverride;
            isPositionApproximate = false;
          } else if (typeof member.node?.locationLat === 'number' && typeof member.node?.locationLng === 'number') {
            lat = member.node.locationLat;
            lng = member.node.locationLng;
            isPositionApproximate = false;
          } else if (typeof geo?.latitude === 'number' && typeof geo?.longitude === 'number') {
            lat = geo.latitude;
            lng = geo.longitude;
            isPositionApproximate = false;
          } else {
            const centroid = countryCentroid(countryCode);
            [lat, lng] = centroid ?? [15, 10];
            isPositionApproximate = true;
          }
          nodes.push({
            id: member.nodeId,
            label: member.node?.name || member.nodeId.slice(0, 8),
            vlanIp: member.vlanIp,
            status: member.node?.status === 'online' ? 'online' : 'offline',
            city: override?.city?.trim() || city,
            country: override?.country?.trim() || country,
            countryCode,
            x: cityCenterX + Math.cos(nodeAngle) * nodeOrbitRadius,
            y: cityCenterY + Math.sin(nodeAngle) * nodeOrbitRadius,
            lat,
            lng,
            isPositionApproximate,
          });
        });
      });
    });

    const bestByPair = new Map<string, GraphLink>();
    for (const connection of physicalConnections) {
      const pair = [connection.sourceNodeId, connection.targetNodeId].sort().join('__');
      const previous = bestByPair.get(pair);
      if (!previous || STATUS_PRIORITY[connection.status] > STATUS_PRIORITY[previous.status]) {
        bestByPair.set(pair, {
          key: pair,
          sourceNodeId: connection.sourceNodeId,
          targetNodeId: connection.targetNodeId,
          status: connection.status,
          latencyMs: connection.latencyMs,
          packetLoss: connection.packetLoss,
          bandwidth: connection.bandwidth,
          trafficScore:
            (typeof connection.bandwidth === 'number' ? Math.max(connection.bandwidth, 0) : 0) +
            (typeof connection.latencyMs === 'number' ? Math.max(150 - connection.latencyMs, 0) : 0),
        });
      }
    }

    return {
      nodes,
      links: Array.from(bestByPair.values()),
    };
  }, [physicalConnections, geoByIp, geoOverrides, mapLocationOverrides, vlanStatus]);

  const persistedGraphPositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    for (const member of vlanStatus?.vlan.members ?? []) {
      if (typeof member.node?.graphX === 'number' && typeof member.node?.graphY === 'number') {
        map.set(member.nodeId, { x: member.node.graphX, y: member.node.graphY });
      }
    }
    return map;
  }, [vlanStatus]);
  const displayedNodes = useMemo(
    () =>
      graph.nodes.map((node) => ({
        ...node,
        ...(persistedGraphPositions.get(node.id) ?? {}),
        ...(nodePositionOverrides[node.id] ?? {}),
      })),
    [graph.nodes, persistedGraphPositions, nodePositionOverrides],
  );
  const worldMapNodes: WorldMapNode[] = useMemo(
    () =>
      graph.nodes.map((node) => ({
        id: node.id,
        label: node.label,
        vlanIp: node.vlanIp,
        status: node.status,
        city: node.city,
        country: node.country,
        countryCode: node.countryCode,
        lat: node.lat,
        lng: node.lng,
        isPositionApproximate: node.isPositionApproximate,
      })),
    [graph.nodes],
  );
  const worldMapLinks: WorldMapLink[] = useMemo(
    () =>
      graph.links.map((link) => ({
        key: link.key,
        sourceNodeId: link.sourceNodeId,
        targetNodeId: link.targetNodeId,
        status: link.status,
        latencyMs: link.latencyMs,
      })),
    [graph.links],
  );
  const handleMapNodeDrag = (nodeId: string, lat: number, lng: number) => {
    setMapLocationOverrides((prev) => ({ ...prev, [nodeId]: [lat, lng] }));
    void api.nodes
      .update(nodeId, { locationLat: lat, locationLng: lng })
      .catch(() => setNotice({ type: 'error', message: 'Impossible d’enregistrer la position sur la carte.' }));
  };
  const { cityBubbles, countryBubbles } = useMemo(() => {
    const cityGroups = new Map<string, GraphNode[]>();
    for (const node of displayedNodes) {
      const cityKey = `${node.country}__${node.city}`;
      const current = cityGroups.get(cityKey) ?? [];
      current.push(node);
      cityGroups.set(cityKey, current);
    }

    const computedCityBubbles: GraphBubble[] = [];
    const countryToCityBubbles = new Map<string, GraphBubble[]>();

    cityGroups.forEach((nodes, key) => {
      const [country, city] = key.split('__');
      const centerX = nodes.reduce((acc, node) => acc + node.x, 0) / nodes.length;
      const centerY = nodes.reduce((acc, node) => acc + node.y, 0) / nodes.length;
      const maxNodeDistance = nodes.reduce((max, node) => {
        const dx = node.x - centerX;
        const dy = node.y - centerY;
        return Math.max(max, Math.hypot(dx, dy));
      }, 0);
      const bubble: GraphBubble = {
        id: `city-${country}-${city}`,
        label: city,
        x: centerX,
        y: centerY,
        r: Math.max(72, maxNodeDistance + NODE_RADIUS + 28),
      };
      computedCityBubbles.push(bubble);
      const bucket = countryToCityBubbles.get(country) ?? [];
      bucket.push(bubble);
      countryToCityBubbles.set(country, bucket);
    });

    const computedCountryBubbles: GraphBubble[] = [];
    countryToCityBubbles.forEach((bubbles, country) => {
      if (bubbles.length === 0) return;
      const centerX = bubbles.reduce((acc, bubble) => acc + bubble.x, 0) / bubbles.length;
      const centerY = bubbles.reduce((acc, bubble) => acc + bubble.y, 0) / bubbles.length;
      const maxBubbleDistance = bubbles.reduce((max, bubble) => {
        const dx = bubble.x - centerX;
        const dy = bubble.y - centerY;
        return Math.max(max, Math.hypot(dx, dy) + bubble.r);
      }, 0);
      computedCountryBubbles.push({
        id: `country-${country}`,
        label: country,
        x: centerX,
        y: centerY,
        r: Math.max(140, maxBubbleDistance + 24),
      });
    });

    return {
      cityBubbles: computedCityBubbles,
      countryBubbles: computedCountryBubbles,
    };
  }, [displayedNodes]);
  const nodeById = useMemo(() => new Map(displayedNodes.map((node) => [node.id, node])), [displayedNodes]);
  const getNodeDisplayName = useCallback(
    (nodeId: string) => nodeLabels[nodeId]?.[0] || nodeById.get(nodeId)?.label || nodeId.slice(0, 8),
    [nodeLabels, nodeById],
  );
  const detectedGeoByNodeId = useMemo(() => {
    const map = new Map<string, { city: string; country: string; countryCode: string | null }>();
    for (const member of vlanStatus?.vlan.members || []) {
      const endpointHost = parseHostFromEndpoint(member.node?.externalIp || member.node?.overlayEndpoint);
      const geo = endpointHost ? geoByIp[endpointHost] : null;
      map.set(member.nodeId, {
        city: geo?.city || 'Ville inconnue',
        country: geo?.country || 'Pays inconnu',
        countryCode: geo?.countryCode ?? null,
      });
    }
    return map;
  }, [geoByIp, vlanStatus]);
  const connectionByDirection = useMemo(
    () => new Map(physicalConnections.map((connection) => [`${connection.sourceNodeId}__${connection.targetNodeId}`, connection])),
    [physicalConnections],
  );
  const memberByNodeId = useMemo(
    () => new Map((vlanStatus?.vlan.members || []).map((member) => [member.nodeId, member])),
    [vlanStatus],
  );
  const memberByVlanIp = useMemo(
    () => new Map((vlanStatus?.vlan.members || []).filter((member) => member.vlanIp).map((member) => [member.vlanIp, member])),
    [vlanStatus],
  );
  const regionSummaries = useMemo(() => {
    const members = vlanStatus?.vlan.members ?? [];
    const byRegion = new Map<string, typeof members>();
    for (const member of members) {
      const key = member.region ?? 'unknown';
      const list = byRegion.get(key) ?? [];
      list.push(member);
      byRegion.set(key, list);
    }
    return Array.from(byRegion.entries()).map(([region, group]) => ({
      region,
      members: group,
      gateway: group.find((m) => m.node?.overlayIsGateway) ?? null,
    }));
  }, [vlanStatus]);
  const knownRegionSummaries = useMemo(
    () => regionSummaries.filter((summary) => summary.region !== 'unknown'),
    [regionSummaries],
  );
  const segmentedRegionPairs = useMemo(() => {
    const withGateway = knownRegionSummaries.filter((summary) => summary.gateway);
    const pairs: Array<[(typeof withGateway)[number], (typeof withGateway)[number]]> = [];
    for (let i = 0; i < withGateway.length; i++) {
      for (let j = i + 1; j < withGateway.length; j++) {
        pairs.push([withGateway[i], withGateway[j]]);
      }
    }
    return pairs;
  }, [knownRegionSummaries]);
  const meshedRegionSummaries = useMemo(
    () => (knownRegionSummaries.length > 1 ? knownRegionSummaries.filter((summary) => !summary.gateway) : []),
    [knownRegionSummaries],
  );
  const directedFlows = useMemo(
    () =>
      [...physicalConnections]
        .map(
          (connection) =>
            ({
              key: `${connection.sourceNodeId}__${connection.targetNodeId}`,
              sourceNodeId: connection.sourceNodeId,
              targetNodeId: connection.targetNodeId,
              status: connection.status,
              latencyMs: connection.latencyMs,
              packetLoss: connection.packetLoss,
              bandwidth: connection.bandwidth,
              trafficScore:
                (typeof connection.bandwidth === 'number' ? Math.max(connection.bandwidth, 0) : 0) +
                (typeof connection.latencyMs === 'number' ? Math.max(150 - connection.latencyMs, 0) : 0),
            }) satisfies DirectedFlow,
        )
        .sort((a, b) => b.trafficScore - a.trafficScore),
    [physicalConnections],
  );
  const selectedFlow = useMemo(
    () => directedFlows.find((flow) => flow.key === selectedFlowKey) ?? null,
    [directedFlows, selectedFlowKey],
  );
  const topTrafficFlows = useMemo(
    () => directedFlows.slice(0, 5),
    [directedFlows],
  );
  // One entry per unordered node pair (A↔B), carrying both directions' flows
  // when known — avoids listing "A→B" and "B→A" as separate history entries.
  const pairFlows = useMemo(() => {
    const byPair = new Map<
      string,
      { key: string; nodeAId: string; nodeBId: string; forward: DirectedFlow | null; reverse: DirectedFlow | null; trafficScore: number }
    >();
    for (const flow of directedFlows) {
      const [nodeAId, nodeBId] = [flow.sourceNodeId, flow.targetNodeId].sort();
      const key = `${nodeAId}__${nodeBId}`;
      const pair = byPair.get(key) ?? { key, nodeAId, nodeBId, forward: null, reverse: null, trafficScore: 0 };
      if (flow.sourceNodeId === nodeAId) {
        pair.forward = flow;
      } else {
        pair.reverse = flow;
      }
      pair.trafficScore = Math.max(pair.trafficScore, flow.trafficScore);
      byPair.set(key, pair);
    }
    return Array.from(byPair.values()).sort((a, b) => b.trafficScore - a.trafficScore);
  }, [directedFlows]);
  // The history card always shows something when there's at least one pair:
  // the explicitly selected one, or — failing that — the most active pair,
  // so the section never sits empty just because nothing's been clicked yet.
  const historyPair = useMemo(
    () => pairFlows.find((pair) => pair.key === selectedPairKey) ?? pairFlows[0] ?? null,
    [pairFlows, selectedPairKey],
  );

  useEffect(() => {
    if (!vlanStatus || !historyPair) {
      setHistoryForward(null);
      setHistoryReverse(null);
      return;
    }
    let cancelled = false;
    const fetchDirection = (flow: DirectedFlow | null) =>
      flow ? api.vlan.getHistory(vlanStatus.vlan.id, flow.sourceNodeId, flow.targetNodeId, historyRange) : Promise.resolve(null);
    void Promise.all([fetchDirection(historyPair.forward), fetchDirection(historyPair.reverse)])
      .then(([forward, reverse]) => {
        if (cancelled) return;
        setHistoryForward(forward);
        setHistoryReverse(reverse);
      })
      .catch((error) => {
        console.error('Failed to fetch connection history:', error);
        if (!cancelled) {
          setHistoryForward(null);
          setHistoryReverse(null);
        }
      });
    return () => {
      cancelled = true;
    };
    // vlanStatus/historyPair are new object references every ~5s poll tick
    // (see the hand-rolled interval above) even when nothing meaningfully
    // changed - depending on their stable identifiers instead of the
    // objects themselves stops this effect (and its 2 HTTP requests) from
    // re-firing on every single tick regardless of whether the selected
    // vlan/pair actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vlanStatus?.vlan.id, historyPair?.key, historyRange]);

  const toHistoryChartData = (history: VlanConnectionHistory | null) =>
    (history?.samples ?? []).map((sample) => ({
      label: new Date(sample.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
      latencyMs: sample.latencyMs ?? null,
      packetLoss: sample.packetLoss ?? null,
    }));
  const historyForwardChartData = useMemo(() => toHistoryChartData(historyForward), [historyForward]);
  const historyReverseChartData = useMemo(() => toHistoryChartData(historyReverse), [historyReverse]);
  const orderedNodes = useMemo(
    () => [...displayedNodes].sort((a, b) => a.label.localeCompare(b.label, 'fr')),
    [displayedNodes],
  );

  const toSvgPoint = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: ((clientX - rect.left) / rect.width) * MIND_MAP_WIDTH,
      y: ((clientY - rect.top) / rect.height) * MIND_MAP_HEIGHT,
    };
  };

  const toWorldPoint = (clientX: number, clientY: number) => {
    const svgPoint = toSvgPoint(clientX, clientY);
    if (!svgPoint) return null;
    return {
      x: (svgPoint.x - viewTransform.tx) / viewTransform.scale,
      y: (svgPoint.y - viewTransform.ty) / viewTransform.scale,
    };
  };

  const zoomFrom = (factor: number, focus?: { x: number; y: number }) => {
    setViewTransform((prev) => {
      const nextScale = clampScale(prev.scale * factor);
      if (nextScale === prev.scale) return prev;
      const center = focus ?? { x: MIND_MAP_WIDTH / 2, y: MIND_MAP_HEIGHT / 2 };
      const worldX = (center.x - prev.tx) / prev.scale;
      const worldY = (center.y - prev.ty) / prev.scale;
      return {
        scale: nextScale,
        tx: center.x - worldX * nextScale,
        ty: center.y - worldY * nextScale,
      };
    });
  };

  const handleMapWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const focus = toSvgPoint(event.clientX, event.clientY);
    if (!focus) return;
    const factor = Math.exp(-event.deltaY * 0.0016);
    zoomFrom(factor, focus);
  };

  const handleMapPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const target = event.target as Element | null;
    if (target?.closest('[data-node-draggable="true"]') || target?.closest('[data-link-clickable="true"]')) return;
    const point = toSvgPoint(event.clientX, event.clientY);
    if (!point) return;
    panRef.current = {
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      startTx: viewTransform.tx,
      startTy: viewTransform.ty,
    };
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const handleMapPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (nodeDragRef.current && nodeDragRef.current.pointerId === event.pointerId) {
      const dragState = nodeDragRef.current;
      const world = toWorldPoint(event.clientX, event.clientY);
      if (!world) return;
      setNodePositionOverrides((prev) => ({
        ...prev,
        [dragState.nodeId]: {
          x: world.x - dragState.offsetX,
          y: world.y - dragState.offsetY,
        },
      }));
      return;
    }

    if (!panRef.current || panRef.current.pointerId !== event.pointerId) return;
    const point = toSvgPoint(event.clientX, event.clientY);
    if (!point) return;
    setViewTransform((prev) => ({
      ...prev,
      tx: panRef.current!.startTx + (point.x - panRef.current!.startX),
      ty: panRef.current!.startTy + (point.y - panRef.current!.startY),
    }));
  };

  const endPointerInteraction = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (nodeDragRef.current?.pointerId === event.pointerId) {
      const { nodeId } = nodeDragRef.current;
      const droppedAt = nodePositionOverrides[nodeId];
      if (droppedAt) {
        void api.nodes
          .update(nodeId, { graphX: droppedAt.x, graphY: droppedAt.y })
          .catch(() => setNotice({ type: 'error', message: 'Impossible d’enregistrer la position dans le graphe.' }));
      }
      nodeDragRef.current = null;
    }
    if (panRef.current?.pointerId === event.pointerId) {
      panRef.current = null;
    }
    if (svgRef.current?.hasPointerCapture(event.pointerId)) {
      svgRef.current.releasePointerCapture(event.pointerId);
    }
  };

  const handleNodePointerDown = (event: ReactPointerEvent<SVGGElement>, nodeId: string) => {
    if (event.button !== 0) return;
    const node = nodeById.get(nodeId);
    const world = toWorldPoint(event.clientX, event.clientY);
    if (!node || !world) return;
    event.stopPropagation();
    nodeDragRef.current = {
      pointerId: event.pointerId,
      nodeId,
      offsetX: world.x - node.x,
      offsetY: world.y - node.y,
    };
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const updateNodeGeoOverride = (nodeId: string, patch: Partial<GeoOverride>) => {
    setGeoOverrides((prev) => {
      const current = prev[nodeId] ?? {};
      return {
        ...prev,
        [nodeId]: {
          ...current,
          ...patch,
          countryCode: normalizeCountryCode(patch.countryCode ?? current.countryCode) ?? '',
        },
      };
    });
    setGeoDirtyByNodeId((prev) => ({ ...prev, [nodeId]: true }));
  };

  const saveNodeGeoOverride = async (nodeId: string, forceAuto = false) => {
    const current = geoOverrides[nodeId] ?? {};
    const locationCity = forceAuto ? null : current.city?.trim() || null;
    const locationCountry = forceAuto ? null : current.country?.trim() || null;
    const locationCountryCode = forceAuto
      ? null
      : normalizeCountryCode(current.countryCode)?.trim() || null;

    // A typed city needs to move the pin, not just relabel it — otherwise
    // every corrected node without a dragged position collapses onto the
    // same country-wide centroid. Resolve it to real coordinates the same
    // way a manual drag on the map would.
    let locationLat: number | null = null;
    let locationLng: number | null = null;
    if (locationCity) {
      const geocoded = await geocodeCity(locationCity, locationCountry);
      if (geocoded) {
        locationLat = geocoded.lat;
        locationLng = geocoded.lng;
      }
    }

    setGeoSavingByNodeId((prev) => ({ ...prev, [nodeId]: true }));
    try {
      const updatedNode = await api.nodes.update(nodeId, {
        locationCity,
        locationCountry,
        locationCountryCode,
        locationLat,
        locationLng,
      });
      setGeoOverrides((prev) => ({
        ...prev,
        [nodeId]: {
          city: updatedNode.locationCity ?? '',
          country: updatedNode.locationCountry ?? '',
          countryCode: normalizeCountryCode(updatedNode.locationCountryCode) ?? '',
        },
      }));
      setGeoDirtyByNodeId((prev) => ({ ...prev, [nodeId]: false }));
      setMapLocationOverrides((prev) => {
        if (typeof updatedNode.locationLat !== 'number' || typeof updatedNode.locationLng !== 'number') {
          const next = { ...prev };
          delete next[nodeId];
          return next;
        }
        return { ...prev, [nodeId]: [updatedNode.locationLat, updatedNode.locationLng] };
      });
      setVlanStatus((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          vlan: {
            ...prev.vlan,
            members: (prev.vlan.members || []).map((member) =>
              member.nodeId === nodeId
                ? {
                    ...member,
                    node: member.node
                      ? {
                          ...member.node,
                          locationCity: updatedNode.locationCity ?? null,
                          locationCountry: updatedNode.locationCountry ?? null,
                          locationCountryCode: updatedNode.locationCountryCode ?? null,
                          locationLat: updatedNode.locationLat ?? null,
                          locationLng: updatedNode.locationLng ?? null,
                        }
                      : member.node,
                  }
                : member,
            ),
          },
        };
      });
    } catch (error) {
      console.error('Failed to save location override:', error);
      setNotice({ type: 'error', message: 'Impossible d’enregistrer la localisation manuelle.' });
    } finally {
      setGeoSavingByNodeId((prev) => ({ ...prev, [nodeId]: false }));
    }
  };

  const handleRunTest = async () => {
    if (!vlanStatus || !selectedTest.from || !selectedTest.to || !selectedTest.type) {
      setNotice({ type: 'error', message: 'Veuillez sélectionner les paramètres du test.' });
      return;
    }

    try {
      setTestRunning(true);
      const result = await api.vlan.runTest(
        vlanStatus.vlan.id,
        selectedTest.from,
        selectedTest.to,
        selectedTest.type,
      );
      setTests((prev) => [result.test, ...prev]);
      setNotice({ type: 'success', message: 'Le test de connectivité a été lancé.' });
    } catch (error) {
      console.error('Test failed:', error);
      setNotice({ type: 'error', message: 'Le test de connectivité a échoué.' });
    } finally {
      setTestRunning(false);
    }
  };

  const handleSetGateway = async (nodeId: string, enabled: boolean) => {
    if (!vlanStatus) return;
    setGatewaySavingByNodeId((prev) => ({ ...prev, [nodeId]: true }));
    try {
      await api.vlan.setGateway(vlanStatus.vlan.id, nodeId, enabled);
      setNotice({
        type: 'success',
        message: enabled ? 'Passerelle régionale définie.' : 'Passerelle régionale retirée.',
      });
      const status = await api.vlan.getStatus(vlanStatus.vlan.id);
      setVlanStatus(status);
    } catch (error) {
      console.error('Failed to set VLAN gateway:', error);
      setNotice({
        type: 'error',
        message: error instanceof Error ? error.message : 'Impossible de définir la passerelle régionale.',
      });
    } finally {
      setGatewaySavingByNodeId((prev) => ({ ...prev, [nodeId]: false }));
    }
  };

  const content = initialLoading ? (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>
      <ChartCardSkeleton height="h-96" />
    </div>
  ) : !vlanStatus ? (
    <Card className="border-border backdrop-blur transition-colors hover:border-border">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <AlertTriangle className="h-8 w-8 text-muted-foreground" />
        <h3 className="text-xl font-semibold text-foreground">Aucun réseau VLAN trouvé</h3>
        <p className="max-w-md text-sm text-muted-foreground">
          Déployez des agents pour initialiser le VLAN. Les liens et métriques apparaîtront automatiquement.
        </p>
      </CardContent>
    </Card>
  ) : (
    <div className="space-y-6 animate-fade-in">
      {notice && (
        <Alert variant={notice.type === 'error' ? 'destructive' : 'success'}>
          {notice.type === 'error' ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
          <AlertDescription>{notice.message}</AlertDescription>
        </Alert>
      )}

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionLabel>Aperçu</SectionLabel>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {lastRefreshAt ? `Dernière sync ${lastRefreshAt.toLocaleTimeString('fr-FR')}` : 'Sync en attente'}
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 cursor-help" />
              </TooltipTrigger>
              <TooltipContent>
                Se met à jour toutes les 5 secondes. Les nœuds communiquent via un tunnel WireGuard chiffré ; si un
                agent ne remonte pas encore ses données, une estimation côté serveur est utilisée.
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard label="Nœuds actifs" value={vlanStatus.memberCount} icon={<Network className="h-8 w-8" />} changeType="neutral" />
          <StatCard
            label="Liens sains"
            value={`${
              vlanStatus.connectionStats.total > 0
                ? Math.round((vlanStatus.connectionStats.healthy / vlanStatus.connectionStats.total) * 100)
                : 100
            }%`}
            icon={<RadioTower className="h-8 w-8" />}
            changeType="up"
          />
          <StatCard
            label="Liens dégradés"
            value={vlanStatus.connectionStats.degraded}
            icon={<Gauge className="h-8 w-8" />}
            changeType={vlanStatus.connectionStats.degraded > 0 ? 'neutral' : 'up'}
          />
          <StatCard
            label="Liens offline"
            value={vlanStatus.connectionStats.offline}
            icon={<Activity className="h-8 w-8" />}
            changeType={vlanStatus.connectionStats.offline > 0 ? 'down' : 'up'}
          />
        </div>
      </section>


      {/* Four stacked bands (overview, diagnostics, topology, history) meant
          the page opened on a form nobody had asked for and buried the map
          two screens down. The bands are the same, but they are now reached
          by name instead of by scrolling, and the tiles above stay visible
          whichever one is open. */}
      <Tabs value={networkTab} onValueChange={setNetworkTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="topology" className="gap-1.5">
            <Share2 className="h-3.5 w-3.5" />
            Topologie
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <Activity className="h-3.5 w-3.5" />
            Historique
          </TabsTrigger>
          <TabsTrigger value="diagnostics" className="gap-1.5">
            <Waves className="h-3.5 w-3.5" />
            Diagnostics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="topology" className="space-y-4">

        {knownRegionSummaries.length > 1 && (
          <Callout>
            <div className="space-y-1.5">
              {segmentedRegionPairs.map(([a, b]) => (
                <p key={`${a.region}-${b.region}`} className="flex flex-wrap items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  Segmentation active : {REGION_LABELS[a.region] ?? a.region} ↔ {REGION_LABELS[b.region] ?? b.region} via{' '}
                  <span className="font-medium text-foreground">{a.gateway?.node?.name ?? a.gateway?.nodeId}</span>
                  <span>↔</span>
                  <span className="font-medium text-foreground">{b.gateway?.node?.name ?? b.gateway?.nodeId}</span>
                </p>
              ))}
              {meshedRegionSummaries.map((summary) => (
                <p key={summary.region} className="flex flex-wrap items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                  {REGION_LABELS[summary.region] ?? summary.region} : aucune passerelle désignée — maillage complet par
                  défaut avec les autres régions.
                </p>
              ))}
            </div>
          </Callout>
        )}

        <Card className="border-border transition-colors hover:border-border">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Globe2 className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base">Régions &amp; passerelles</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {regionSummaries.map(({ region, members, gateway }) => (
              <div key={region} className="rounded-xl border border-border bg-surface-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">
                    {region === 'unknown' ? 'Région inconnue' : REGION_LABELS[region] ?? region}
                  </p>
                  <span className="text-xs text-muted-foreground">
                    {members.length} nœud{members.length > 1 ? 's' : ''}
                  </span>
                </div>
                {region === 'unknown' ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Localisation manquante — définissez un pays dans le panneau ci-dessous pour activer la segmentation
                    sur ces nœuds.
                  </p>
                ) : (
                  <>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {members.map((member) => {
                        const isGateway = Boolean(member.node?.overlayIsGateway);
                        return (
                          <Button
                            key={member.nodeId}
                            size="sm"
                            variant={isGateway ? 'default' : 'outline'}
                            disabled={gatewaySavingByNodeId[member.nodeId]}
                            onClick={() => void handleSetGateway(member.nodeId, !isGateway)}
                          >
                            {gatewaySavingByNodeId[member.nodeId]
                              ? 'Enregistrement…'
                              : `${member.node?.name ?? member.nodeId}${isGateway ? ' · Passerelle ✓' : ''}`}
                          </Button>
                        );
                      })}
                    </div>
                    {!gateway && (
                      <p className="mt-2 text-2xs text-muted-foreground">
                        Aucune passerelle désignée dans cette région — clique un nœud ci-dessus pour l’activer.
                      </p>
                    )}
                  </>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[1.6fr_minmax(0,1fr)]">
          <Card className="border-border transition-colors hover:border-border">
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Tabs value={mapView} onValueChange={(value) => setMapView(value === 'graph' ? 'graph' : 'map')}>
                  <TabsList>
                    <TabsTrigger value="map" className="gap-1.5">
                      <Globe2 className="h-3.5 w-3.5" />
                      Carte
                    </TabsTrigger>
                    <TabsTrigger value="graph" className="gap-1.5">
                      <Network className="h-3.5 w-3.5" />
                      Graphe
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                {mapView === 'graph' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => zoomFrom(1.16)}
                    >
                      Zoom +
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => zoomFrom(1 / 1.16)}
                    >
                      Zoom -
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setViewTransform({ scale: 1, tx: 0, ty: 0 })}
                    >
                      Recentrer
                    </Button>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {mapView === 'map'
                  ? 'Molette pour zoomer, glisser le fond pour déplacer la vue, glisser un point pour corriger sa position exacte. Les nœuds à la même localisation sont regroupés en badge tant que vous n’avez pas zoomé assez près.'
                  : 'Molette pour zoomer, glisser le fond pour déplacer la vue, glisser un nœud pour le repositionner.'}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {mapView === 'map' ? (
                <WorldMap
                  nodes={worldMapNodes}
                  links={worldMapLinks}
                  onNodeDrag={handleMapNodeDrag}
                  onSelectNode={setSelectedMapNodeId}
                  className="h-[560px] w-full"
                />
              ) : (
              <div className="rounded-xl border border-border bg-surface-2 p-4">
                <svg
                  ref={svgRef}
                  viewBox={`0 0 ${MIND_MAP_WIDTH} ${MIND_MAP_HEIGHT}`}
                  className="h-[560px] w-full touch-none"
                  onWheel={handleMapWheel}
                  onPointerDown={handleMapPointerDown}
                  onPointerMove={handleMapPointerMove}
                  onPointerUp={endPointerInteraction}
                  onPointerCancel={endPointerInteraction}
                >
                  <g transform={`translate(${viewTransform.tx} ${viewTransform.ty}) scale(${viewTransform.scale})`}>
                    {countryBubbles.map((bubble) => (
                      <g key={bubble.id}>
                        <circle
                          cx={bubble.x}
                          cy={bubble.y}
                          r={bubble.r}
                          fill="rgba(59,130,246,0.04)"
                          stroke="rgba(59,130,246,0.18)"
                          strokeWidth={1.5}
                        />
                        <text
                          x={bubble.x}
                          y={bubble.y - bubble.r + 18}
                          textAnchor="middle"
                          fill="rgba(191,219,254,0.85)"
                          fontSize={11}
                          fontFamily="ui-sans-serif, system-ui, sans-serif"
                        >
                          {bubble.label}
                        </text>
                      </g>
                    ))}
                    {cityBubbles.map((bubble) => (
                      <g key={bubble.id}>
                        <circle
                          cx={bubble.x}
                          cy={bubble.y}
                          r={bubble.r}
                          fill="rgba(139,92,246,0.04)"
                          stroke="rgba(139,92,246,0.2)"
                          strokeWidth={1}
                        />
                        <text
                          x={bubble.x}
                          y={bubble.y - bubble.r + 14}
                          textAnchor="middle"
                          fill="rgba(221,214,254,0.75)"
                          fontSize={10}
                          fontFamily="ui-sans-serif, system-ui, sans-serif"
                        >
                          {bubble.label}
                        </text>
                      </g>
                    ))}
                    {graph.links.map((link) => {
                      const source = nodeById.get(link.sourceNodeId);
                      const target = nodeById.get(link.targetNodeId);
                      if (!source || !target) return null;

                      const isSelected = selectedPairKey === link.key;
                      return (
                        <g
                          key={link.key}
                          data-link-clickable="true"
                          onClick={() => {
                            setSelectedPairKey(link.key);
                            const bestDirectional = directedFlows.find(
                              (flow) => [flow.sourceNodeId, flow.targetNodeId].sort().join('__') === link.key,
                            );
                            setSelectedFlowKey(bestDirectional?.key ?? null);
                          }}
                          className="cursor-pointer"
                        >
                          <line
                            x1={source.x}
                            y1={source.y}
                            x2={target.x}
                            y2={target.y}
                            stroke={linkStroke(link.status)}
                            strokeWidth={isSelected ? 4 : link.status === 'offline' ? 2 : 3}
                            strokeDasharray={link.status === 'offline' ? '6 6' : undefined}
                            style={{ filter: linkGlow(link.status) }}
                          />
                          {link.status !== 'offline' && (
                            <circle r={isSelected ? 5 : 4} fill={linkStroke(link.status)}>
                              <animateMotion dur={linkPulseDuration(link.latencyMs)} repeatCount="indefinite" rotate="auto">
                                <mpath href={`#path-${link.key}`} />
                              </animateMotion>
                            </circle>
                          )}
                          <path
                            id={`path-${link.key}`}
                            d={`M ${source.x} ${source.y} L ${target.x} ${target.y}`}
                            fill="none"
                            stroke="none"
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

                    {displayedNodes.map((node) => {
                      const nameLine = `${flagFromCountryCode(node.countryCode)} ${getNodeDisplayName(node.id)}`;
                      const detailLine = `${node.city} · ${node.vlanIp}`;
                      // Rough char-width estimate (no canvas measurement available in SVG) so the
                      // backing plate covers whichever line is wider, keeping neighbouring node
                      // labels from visually merging when nodes sit close together.
                      const labelWidth = Math.max(nameLine.length * 7.2, detailLine.length * 6.2) + 16;
                      return (
                        <g
                          key={node.id}
                          data-node-draggable="true"
                          onPointerDown={(event) => handleNodePointerDown(event, node.id)}
                          className="cursor-grab active:cursor-grabbing"
                        >
                          <circle cx={node.x} cy={node.y} r={26} fill="rgba(9,9,11,0.95)" stroke={nodeFill(node.status)} strokeWidth={2.5} />
                          <circle cx={node.x} cy={node.y} r={10} fill={nodeFill(node.status)} />
                          <rect
                            x={node.x - labelWidth / 2}
                            y={node.y + 40}
                            width={labelWidth}
                            height={42}
                            rx={8}
                            fill="rgba(9,9,11,0.85)"
                          />
                          <text
                            x={node.x}
                            y={node.y + 54}
                            textAnchor="middle"
                            fill="rgba(244,244,245,0.94)"
                            fontSize={13}
                            fontFamily="ui-sans-serif, system-ui, sans-serif"
                          >
                            {nameLine}
                          </text>
                          <text
                            x={node.x}
                            y={node.y + 74}
                            textAnchor="middle"
                            fill="rgba(161,161,170,0.95)"
                            fontSize={11}
                            fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                          >
                            {detailLine}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                </svg>
              </div>
              )}
              <div className="rounded-xl border border-border bg-surface-2 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-foreground/90">Localisation manuelle des nœuds</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setNodePositionOverrides({});
                      for (const nodeId of persistedGraphPositions.keys()) {
                        void api.nodes.update(nodeId, { graphX: null, graphY: null }).catch(() => {});
                      }
                    }}
                  >
                    Réinitialiser les positions
                  </Button>
                </div>
                <p className="mb-3 text-xs text-muted-foreground">
                  Corrigez la ville/pays si la détection automatique par IP est incorrecte. Les changements sont enregistrés côté serveur et partagés entre clients.
                </p>
                <div className="max-h-56 space-y-2 overflow-auto pr-1">
                  {orderedNodes.map((node) => {
                    const override = geoOverrides[node.id] ?? {};
                    const detected = detectedGeoByNodeId.get(node.id);
                    const member = memberByNodeId.get(node.id);
                    const region = member?.region ?? null;
                    const isGateway = Boolean(member?.node?.overlayIsGateway);
                    return (
                      <div key={`override-${node.id}`} className="rounded-lg border border-border bg-surface-2 p-2">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-medium text-foreground">{node.label}</p>
                          <p className="text-[10px] font-mono text-muted-foreground">{node.vlanIp}</p>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-[1fr_1fr_88px_auto]">
                          <Input
                            value={override.city ?? ''}
                            onChange={(event) => updateNodeGeoOverride(node.id, { city: event.target.value })}
                            onBlur={() => void saveNodeGeoOverride(node.id)}
                            placeholder={detected?.city ?? 'Ville inconnue'}
                          />
                          <Input
                            value={override.country ?? ''}
                            onChange={(event) => updateNodeGeoOverride(node.id, { country: event.target.value })}
                            onBlur={() => void saveNodeGeoOverride(node.id)}
                            placeholder={detected?.country ?? 'Pays inconnu'}
                          />
                          <Input
                            value={override.countryCode ?? ''}
                            onChange={(event) => updateNodeGeoOverride(node.id, { countryCode: event.target.value })}
                            onBlur={() => void saveNodeGeoOverride(node.id)}
                            placeholder={detected?.countryCode ?? '--'}
                            maxLength={2}
                            className="uppercase"
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              updateNodeGeoOverride(node.id, { city: '', country: '', countryCode: '' });
                              void saveNodeGeoOverride(node.id, true);
                            }}
                            disabled={geoSavingByNodeId[node.id]}
                          >
                            {geoSavingByNodeId[node.id] ? 'Enregistrement…' : 'Auto'}
                          </Button>
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <Badge
                            label={region ? REGION_LABELS[region] ?? region : 'Région inconnue'}
                            type={region ? 'info' : 'warning'}
                          />
                          {isGateway && <Badge label="Passerelle régionale" type="warning" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border backdrop-blur transition-colors hover:border-border">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-base">Flux actifs</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {(selectedFlow ? [selectedFlow] : topTrafficFlows).map((flow) => {
                const source = nodeById.get(flow.sourceNodeId);
                const target = nodeById.get(flow.targetNodeId);
                if (!source || !target) return null;
                return (
                  <div
                    key={`${flow.key}-card`}
                    className="rounded-xl border border-border bg-surface-2 p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-foreground">
                        {source.label} → {target.label}
                      </p>
                      <Badge label={getConnectionLabel(flow.status)} type={getConnectionBadgeVariant(flow.status)} />
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded-lg border border-border bg-black/25 px-2 py-1.5">
                        <p className="text-[10px] text-muted-foreground">Latence</p>
                        <p className="font-mono">{formatLatency(flow.latencyMs)}</p>
                      </div>
                      <div className="rounded-lg border border-border bg-black/25 px-2 py-1.5">
                        <p className="text-[10px] text-muted-foreground">Perte</p>
                        <p className="font-mono">{formatLoss(flow.packetLoss)}</p>
                      </div>
                      <div className="rounded-lg border border-border bg-black/25 px-2 py-1.5">
                        <p className="text-[10px] text-muted-foreground">Débit</p>
                        <p className="font-mono">{formatBandwidth(flow.bandwidth)}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
              {!selectedFlow && topTrafficFlows.length === 0 && (
                <p className="text-xs text-muted-foreground">Aucun flux détecté.</p>
              )}
              {selectedFlow && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setSelectedFlowKey(null);
                    setSelectedPairKey(null);
                  }}
                >
                  Revenir au top flux
                </Button>
              )}
            </CardContent>
          </Card>
        </div>

        </TabsContent>

        <TabsContent value="history" className="space-y-4">
        <Card className="border-border backdrop-blur transition-colors hover:border-border">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Waves className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-base">Historique du lien</CardTitle>
              </div>
              <Tabs value={historyRange} onValueChange={(value) => setHistoryRange(value as '1h' | '24h' | '7d')}>
                <TabsList>
                  <TabsTrigger value="1h">1 h</TabsTrigger>
                  <TabsTrigger value="24h">24 h</TabsTrigger>
                  <TabsTrigger value="7d">7 j</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {historyPair ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Select
                    value={historyPair.key}
                    onValueChange={(value) => {
                      const pair = pairFlows.find((candidate) => candidate.key === value);
                      if (!pair) return;
                      setSelectedPairKey(pair.key);
                      setSelectedFlowKey(pair.forward?.key ?? pair.reverse?.key ?? null);
                    }}
                  >
                    <SelectTrigger className="w-auto min-w-[220px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {pairFlows.map((pair) => (
                        <SelectItem key={pair.key} value={pair.key}>
                          {getNodeDisplayName(pair.nodeAId)} ↔ {getNodeDisplayName(pair.nodeBId)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!selectedPairKey && (
                    <p className="text-2xs text-muted-foreground">
                      Lien le plus actif — choisissez-en un autre ci-dessus ou dans la topologie.
                    </p>
                  )}
                </div>

                {(
                  [
                    { flow: historyPair.forward, history: historyForward, chartData: historyForwardChartData },
                    { flow: historyPair.reverse, history: historyReverse, chartData: historyReverseChartData },
                  ] as const
                ).map(({ flow, history, chartData }, index) =>
                  flow ? (
                    <div key={index} className="space-y-2">
                      <p className="font-mono text-xs text-zinc-300">
                        {getNodeDisplayName(flow.sourceNodeId)} → {getNodeDisplayName(flow.targetNodeId)}
                      </p>
                      <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-stretch">
                        <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-border bg-black/20 px-8 py-4 sm:min-w-[150px]">
                          <p className="text-2xs uppercase tracking-wide text-muted-foreground">Uptime</p>
                          <p className={`text-3xl font-semibold tabular-nums ${history ? uptimeToneClass(history.uptimePercent) : 'text-muted-foreground'}`}>
                            {history ? `${history.uptimePercent}%` : '—'}
                          </p>
                          <p className="text-2xs text-muted-foreground">sur {HISTORY_RANGE_LABELS[historyRange]}</p>
                        </div>
                        <div className="rounded-xl border border-border bg-black/10 p-3">
                          <ConnectionHistoryChart data={chartData} />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p key={index} className="text-xs text-muted-foreground">
                      Aucune mesure enregistrée dans ce sens pour l’instant.
                    </p>
                  ),
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Aucun lien détecté pour l’instant.</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-border backdrop-blur transition-colors hover:border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="h-4 w-4 text-primary" />
              Matrice de connexion (vue grille)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto rounded-xl border border-border bg-surface-2 p-3">
              <div
                className="grid min-w-[760px] gap-2"
                style={{ gridTemplateColumns: `220px repeat(${graph.nodes.length}, minmax(128px, 1fr))` }}
              >
                <div className="sticky left-0 z-10 rounded-lg border border-border bg-zinc-900/95 px-3 py-2 text-xs font-medium text-muted-foreground">
                  Source \ Cible
                </div>
                {graph.nodes.map((col) => (
                  <div
                    key={`col-${col.id}`}
                    className="rounded-lg border border-border bg-zinc-900/85 px-3 py-2 text-xs"
                  >
                    <p className="truncate font-medium text-foreground">{col.label}</p>
                    <p className="truncate font-mono text-[10px] text-muted-foreground">{col.vlanIp}</p>
                  </div>
                ))}

                {graph.nodes.map((row) => (
                  <div key={`row-${row.id}`} className="contents">
                    <div className="sticky left-0 z-10 rounded-lg border border-border bg-zinc-900/95 px-3 py-2 text-xs">
                      <p className="truncate font-medium text-foreground">{row.label}</p>
                      <p className="truncate font-mono text-[10px] text-muted-foreground">{row.vlanIp}</p>
                    </div>
                    {graph.nodes.map((col) => {
                      if (row.id === col.id) {
                        return (
                          <div
                            key={`cell-${row.id}-${col.id}`}
                            className="rounded-lg border border-dashed border-border bg-zinc-900/40 px-3 py-2 text-center text-[10px] text-muted-foreground"
                          >
                            même nœud
                          </div>
                        );
                      }

                      if (!isPhysicalLink(row.id, col.id)) {
                        return (
                          <div
                            key={`cell-${row.id}-${col.id}`}
                            className="rounded-lg border border-dashed border-border bg-zinc-900/40 px-3 py-2 text-center text-[10px] text-muted-foreground"
                          >
                            Relayé via passerelle
                          </div>
                        );
                      }

                      const direct = connectionByDirection.get(`${row.id}__${col.id}`);

                      return (
                        <button
                          key={`cell-${row.id}-${col.id}`}
                          type="button"
                          onClick={() => {
                            setSelectedPairKey([row.id, col.id].sort().join('__'));
                            setSelectedFlowKey(`${row.id}__${col.id}`);
                          }}
                          className={`rounded-lg border px-2 py-2 text-left transition hover:border-violet-400/40 ${matrixCellTone(
                            direct?.status,
                          )}`}
                        >
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {direct ? getConnectionLabel(direct.status) : 'Aucune route'}
                          </p>
                          <p className="font-mono text-2xs">{formatLatency(direct?.latencyMs)}</p>
                          <p className="font-mono text-[10px] text-muted-foreground">
                            {formatLoss(direct?.packetLoss)} · {formatBandwidth(direct?.bandwidth)}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
        </TabsContent>

        <TabsContent value="diagnostics" className="space-y-4">
        <Card className="border-border backdrop-blur transition-colors hover:border-border">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Waves className="h-5 w-5 text-muted-foreground" />
              <CardTitle className="text-base">Tests de connectivité</CardTitle>
            </div>
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
                        {(m.node?.name || m.nodeId) +
                          ` (${m.vlanIp})` +
                          ((nodeLabels[m.nodeId]?.length ?? 0) > 0 ? ` — ${nodeLabels[m.nodeId].join(', ')}` : '')}
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
                          {(m.node?.name || m.nodeId) +
                            ` (${m.vlanIp})` +
                            ((nodeLabels[m.nodeId]?.length ?? 0) > 0 ? ` — ${nodeLabels[m.nodeId].join(', ')}` : '')}
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

            <Button onClick={handleRunTest} disabled={testRunning} className="w-full">
              <Play className="h-4 w-4" />
              {testRunning ? 'Test en cours...' : 'Exécuter le test'}
            </Button>

            {tests.length > 0 && (
              <div className="space-y-2">
                {tests.slice(0, 5).map((test) => (
                  <div
                    key={test.id}
                    className="rounded-xl border border-border bg-surface-2 px-4 py-3"
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <p className="font-mono text-xs text-foreground">
                          {(memberByNodeId.get(test.initiatorNodeId)?.vlanIp || test.initiatorNodeId.slice(0, 8))} →{' '}
                          {(memberByNodeId.get(test.targetNodeId)?.vlanIp || test.targetNodeId.slice(0, 8))}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {test.testType === 'traceroute'
                            ? `${test.hops?.length ?? 0} saut(s)`
                            : `${formatLatency(test.latencyMs)} · ${formatLoss(test.packetLoss)}`}
                        </p>
                        {test.status !== 'success' && test.status !== 'pending' && test.resultMessage && (
                          <p className="text-xs text-rose-400">{test.resultMessage}</p>
                        )}
                      </div>
                      <Badge
                        label={testStatusLabel[test.status]}
                        type={test.status === 'success' ? 'success' : test.status === 'pending' ? 'info' : 'error'}
                        icon={<Waves className="h-3 w-3" />}
                      />
                    </div>
                    {test.testType === 'traceroute' && test.hops && test.hops.length > 0 && (
                      <ol className="mt-3 space-y-1.5 border-t border-border pt-3">
                        {test.hops.map((hop) => {
                          const hopMember = hop.ip ? memberByVlanIp.get(hop.ip) : undefined;
                          return (
                            <li key={hop.hop} className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="w-5 shrink-0 text-right font-mono text-2xs text-muted-foreground">
                                {hop.hop}
                              </span>
                              <span className="font-mono text-zinc-300">{hop.ip ?? '* (aucune réponse)'}</span>
                              {hopMember && (
                                <span className="text-foreground">
                                  {hopMember.node?.name ?? hopMember.nodeId}
                                </span>
                              )}
                              {hopMember?.region && (
                                <Badge label={REGION_LABELS[hopMember.region] ?? hopMember.region} type="info" />
                              )}
                              {hopMember?.node?.overlayIsGateway && <Badge label="Passerelle" type="warning" />}
                              <span className="ml-auto font-mono text-2xs text-muted-foreground">
                                {formatLatency(hop.latencyMs)}
                              </span>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        </TabsContent>
      </Tabs>
    </div>
  );

  return (
      <div className="space-y-6">
        <PageHeader
          title="Réseau"
          description="Visualisez le VLAN privé qui relie vos nœuds et testez la connectivité entre eux."
        />

        {content}
      </div>
  );
}
