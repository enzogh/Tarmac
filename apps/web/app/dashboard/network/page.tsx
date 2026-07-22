'use client';

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Gauge,
  Network,
  Play,
  RadioTower,
  RefreshCw,
  Waves,
  Zap,
} from 'lucide-react';
import { api, VlanConnection, VlanConnectionTest, VlanStatus } from '@/lib/api';
import { GeoInfo, flagFromCountryCode, getGeoInfo, parseHostFromEndpoint } from '@/lib/geo';
import { readNodeLabels } from '../../../lib/node-labels';
import { DashboardLayout } from '@/components/DashboardLayout';
import { PageHeader } from '../../../components/PageHeader';
import { SectionLabel } from '../../../components/SectionLabel';
import { Callout } from '../../../components/Callout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge, StatCard } from '@/components/ui';
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
  city: string;
  country: string;
  countryCode: string | null;
  x: number;
  y: number;
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
  { value: 'connectivity', label: 'Connectivité' },
  { value: 'latency', label: 'Latence' },
];

const testStatusLabel: Record<VlanConnectionTest['status'], string> = {
  pending: 'En attente',
  success: 'Réussi',
  failed: 'Échoué',
  timeout: 'Délai dépassé',
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

const isTestType = (value: string): value is TestType =>
  value === 'ping' || value === 'connectivity' || value === 'latency';

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
  return 'border-white/10 bg-zinc-900/60 text-zinc-400';
};

const clampScale = (value: number) => Math.max(0.45, Math.min(3.2, value));
const NODE_RADIUS = 26;

const normalizeCountryCode = (value?: string | null) => {
  const trimmed = value?.trim().toUpperCase();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 2);
};

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
  const [viewTransform, setViewTransform] = useState({ scale: 1, tx: 0, ty: 0 });
  const [selectedTest, setSelectedTest] = useState<{
    from?: string;
    to?: string;
    type?: TestType;
  }>({});
  const [nodeLabels, setNodeLabels] = useState<Record<string, string[]>>({});
  const svgRef = useRef<SVGSVGElement | null>(null);
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; startTx: number; startTy: number } | null>(null);
  const nodeDragRef = useRef<{ pointerId: number; nodeId: string; offsetX: number; offsetY: number } | null>(null);

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
    const interval = setInterval(() => {
      void fetchData(false);
    }, 5000);
    return () => clearInterval(interval);
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
          });
        });
      });
    });

    const bestByPair = new Map<string, GraphLink>();
    for (const connection of connections) {
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
  }, [connections, geoByIp, geoOverrides, vlanStatus]);

  const displayedNodes = useMemo(
    () =>
      graph.nodes.map((node) => ({
        ...node,
        ...(nodePositionOverrides[node.id] ?? {}),
      })),
    [graph.nodes, nodePositionOverrides],
  );
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
    () => new Map(connections.map((connection) => [`${connection.sourceNodeId}__${connection.targetNodeId}`, connection])),
    [connections],
  );
  const memberByNodeId = useMemo(
    () => new Map((vlanStatus?.vlan.members || []).map((member) => [member.nodeId, member])),
    [vlanStatus],
  );
  const directedFlows = useMemo(
    () =>
      [...connections]
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
    [connections],
  );
  const selectedFlow = useMemo(
    () => directedFlows.find((flow) => flow.key === selectedFlowKey) ?? null,
    [directedFlows, selectedFlowKey],
  );
  const topTrafficFlows = useMemo(
    () => directedFlows.slice(0, 5),
    [directedFlows],
  );
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

    setGeoSavingByNodeId((prev) => ({ ...prev, [nodeId]: true }));
    try {
      const updatedNode = await api.nodes.update(nodeId, {
        locationCity,
        locationCountry,
        locationCountryCode,
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

  const content = initialLoading ? (
    <div className="flex h-96 items-center justify-center">
      <p className="text-muted-foreground">Chargement du réseau...</p>
    </div>
  ) : !vlanStatus ? (
    <Card className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <AlertTriangle className="h-8 w-8 text-violet-400" />
        <h3 className="text-xl font-semibold text-foreground">Aucun réseau VLAN trouvé</h3>
        <p className="max-w-md text-sm text-muted-foreground">
          Déployez des agents pour initialiser le VLAN. Les liens et métriques apparaîtront automatiquement.
        </p>
      </CardContent>
    </Card>
  ) : (
    <div className="space-y-6">
      {notice && (
        <Alert variant={notice.type === 'error' ? 'destructive' : 'success'}>
          {notice.type === 'error' ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
          <AlertDescription>{notice.message}</AlertDescription>
        </Alert>
      )}

      <section className="space-y-4">
        <SectionLabel>Aperçu</SectionLabel>
        <Callout>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>
              Cette page se met à jour automatiquement toutes les 5 secondes. Les nœuds communiquent via un tunnel
              réseau privé chiffré (WireGuard) ; si un agent ne remonte pas encore ses données, une estimation
              côté serveur est utilisée à la place.
            </p>
            <div className="flex items-center gap-2 text-xs text-violet-200/80">
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              {lastRefreshAt
                ? `Dernière sync ${lastRefreshAt.toLocaleTimeString('fr-FR')}`
                : 'Sync en attente'}
            </div>
          </div>
        </Callout>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
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

      <SectionLabel>Topologie</SectionLabel>
      <div className="grid gap-4 xl:grid-cols-[1.6fr_minmax(0,1fr)]">
        <Card className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">Vue interconnexion (mind map live)</CardTitle>
              <div className="flex items-center gap-2">
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
            </div>
            <p className="text-xs text-muted-foreground">
              Molette pour zoomer, glisser le fond pour déplacer la vue, glisser un nœud pour le repositionner.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-white/[0.08] bg-zinc-950/50 p-4">
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

                  {displayedNodes.map((node) => (
                    <g
                      key={node.id}
                      data-node-draggable="true"
                      onPointerDown={(event) => handleNodePointerDown(event, node.id)}
                      className="cursor-grab active:cursor-grabbing"
                    >
                      <circle cx={node.x} cy={node.y} r={26} fill="rgba(9,9,11,0.95)" stroke={nodeFill(node.status)} strokeWidth={2.5} />
                      <circle cx={node.x} cy={node.y} r={10} fill={nodeFill(node.status)} />
                      <text
                        x={node.x}
                        y={node.y + 54}
                        textAnchor="middle"
                        fill="rgba(244,244,245,0.94)"
                        fontSize={13}
                        fontFamily="ui-sans-serif, system-ui, sans-serif"
                      >
                        {flagFromCountryCode(node.countryCode)} {node.label}
                      </text>
                      <text
                        x={node.x}
                        y={node.y + 74}
                        textAnchor="middle"
                        fill="rgba(161,161,170,0.95)"
                        fontSize={11}
                        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                      >
                        {node.city} · {node.vlanIp}
                      </text>
                    </g>
                  ))}
                </g>
              </svg>
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-zinc-950/50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-zinc-200">Localisation manuelle des nœuds</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setNodePositionOverrides({})}
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
                  return (
                    <div key={`override-${node.id}`} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-medium text-zinc-100">{node.label}</p>
                        <p className="text-[10px] font-mono text-zinc-400">{node.vlanIp}</p>
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
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-base">Flux actifs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {(selectedFlow ? [selectedFlow] : topTrafficFlows).map((flow) => {
              const source = nodeById.get(flow.sourceNodeId);
              const target = nodeById.get(flow.targetNodeId);
              if (!source || !target) return null;
              return (
                <div
                  key={`${flow.key}-card`}
                  className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-zinc-100">
                      {source.label} → {target.label}
                    </p>
                    <Badge label={getConnectionLabel(flow.status)} type={getConnectionBadgeVariant(flow.status)} />
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-lg border border-white/[0.06] bg-black/25 px-2 py-1.5">
                      <p className="text-[10px] text-muted-foreground">Latence</p>
                      <p className="font-mono">{formatLatency(flow.latencyMs)}</p>
                    </div>
                    <div className="rounded-lg border border-white/[0.06] bg-black/25 px-2 py-1.5">
                      <p className="text-[10px] text-muted-foreground">Perte</p>
                      <p className="font-mono">{formatLoss(flow.packetLoss)}</p>
                    </div>
                    <div className="rounded-lg border border-white/[0.06] bg-black/25 px-2 py-1.5">
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

      <Card className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4 text-violet-300" />
            Matrice de connexion (vue grille)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto rounded-xl border border-white/[0.08] bg-zinc-950/50 p-3">
            <div
              className="grid min-w-[760px] gap-2"
              style={{ gridTemplateColumns: `220px repeat(${graph.nodes.length}, minmax(128px, 1fr))` }}
            >
              <div className="sticky left-0 z-10 rounded-lg border border-white/[0.08] bg-zinc-900/95 px-3 py-2 text-xs font-medium text-muted-foreground">
                Source \ Cible
              </div>
              {graph.nodes.map((col) => (
                <div
                  key={`col-${col.id}`}
                  className="rounded-lg border border-white/[0.08] bg-zinc-900/85 px-3 py-2 text-xs"
                >
                  <p className="truncate font-medium text-zinc-100">{col.label}</p>
                  <p className="truncate font-mono text-[10px] text-zinc-400">{col.vlanIp}</p>
                </div>
              ))}

              {graph.nodes.map((row) => (
                <div key={`row-${row.id}`} className="contents">
                  <div className="sticky left-0 z-10 rounded-lg border border-white/[0.08] bg-zinc-900/95 px-3 py-2 text-xs">
                    <p className="truncate font-medium text-zinc-100">{row.label}</p>
                    <p className="truncate font-mono text-[10px] text-zinc-400">{row.vlanIp}</p>
                  </div>
                  {graph.nodes.map((col) => {
                    if (row.id === col.id) {
                      return (
                        <div
                          key={`cell-${row.id}-${col.id}`}
                          className="rounded-lg border border-dashed border-white/10 bg-zinc-900/40 px-3 py-2 text-center text-[10px] text-zinc-500"
                        >
                          même nœud
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
                        <p className="font-mono text-[11px]">{formatLatency(direct?.latencyMs)}</p>
                        <p className="font-mono text-[10px] text-zinc-400">
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

      <SectionLabel>Diagnostics</SectionLabel>
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
                  className="flex items-start justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3"
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
                  <Badge
                    label={testStatusLabel[test.status]}
                    type={test.status === 'success' ? 'success' : test.status === 'pending' ? 'info' : 'error'}
                    icon={<Waves className="h-3 w-3" />}
                  />
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
        <PageHeader
          icon={Network}
          title="Réseau"
          description="Visualisez le VLAN privé qui relie vos nœuds et testez la connectivité entre eux."
        />

        {content}
      </div>
    </DashboardLayout>
  );
}
