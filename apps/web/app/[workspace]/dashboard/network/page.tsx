'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import dynamic from 'next/dynamic';
import { Activity, ArrowRight, FileText, Gauge, Globe2, Info, LocateFixed, Minus, Network, Plus, RadioTower, RefreshCw, Share2, Waves, X, Zap } from 'lucide-react';
import { api, VlanConnection, VlanConnectionHistory, VlanConnectionTest, VlanStatus } from '@/lib/api';
import { shortHostname } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Stat, StatRow } from '@/components/ui/stat';
import { StatusDot, StatusPill } from '@/components/ui/status';
import {
  ConnectionMatrix,
  DiagnosticsPanel,
  formatMs,
  formatPercent,
  LINK_STATUS,
  LinksPanel,
  LocationEditor,
  regionLabel,
  sortLinks,
  SegmentationCard,
  type LinkStatus,
  type LinkSummary,
  type LocationRow,
} from './components/network-ui';
import {
  computeDefaultPositions,
  computeParcels,
  contentBounds,
  fitTransform,
  layoutSignature,
  NODE_DISC_RADIUS,
  NODE_FOOTPRINT_RADIUS,
  regionHue,
  type LayoutMember,
} from './components/graph-layout';
import { ConnectionHistoryChart } from '@/components/dashboard-charts';
import { HostReportDialog } from './components/HostReportDialog';
import { GeoInfo, flagFromCountryCode, geocodeCity, getGeoInfo, normalizeCountryCode, parseHostFromEndpoint } from '@/lib/geo';
import { countryCentroid } from '@/lib/country-centroids';
import { PageHeader } from '../../../../components/PageHeader';
import { Callout } from '../../../../components/Callout';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../components/ui/tooltip';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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

// The IP-based position only stands in for a manual location saved
// without coordinates when it agrees with it (same country, same city if
// one was typed).
function geoIpMatchesManualLocation(
  manual: { city?: string; countryCode?: string } | undefined,
  geo: { city?: string | null; countryCode?: string | null },
): boolean {
  const manualCountry = normalizeCountryCode(manual?.countryCode);
  const manualCity = manual?.city?.trim().toLowerCase();
  if (manualCountry && manualCountry !== normalizeCountryCode(geo.countryCode)) return false;
  if (manualCity && manualCity !== (geo.city ?? '').trim().toLowerCase()) return false;
  return true;
}

const WorldMap = dynamic(() => import('@/components/WorldMap').then((mod) => mod.WorldMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-[560px] items-center justify-center rounded-xl border border-border bg-surface-2 text-sm text-muted-foreground">
      Chargement de la carte…
    </div>
  ),
});

type TestType = 'ping' | 'traceroute';

type GraphNode = {
  id: string;
  label: string;
  vlanIp: string;
  status: 'online' | 'offline' | 'degraded';
  city: string;
  country: string;
  countryCode: string | null;
  region: string | null;
  isGateway: boolean;
  x: number;
  y: number;
  lat: number;
  lng: number;
  isPositionApproximate: boolean;
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

const STATUS_PRIORITY: Record<LinkStatus, number> = {
  healthy: 0,
  unknown: 1,
  degraded: 2,
  offline: 3,
};

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

// Rough text width (no measuring in SVG): ~0.6 em per character.
const textWidth = (text: string, fontSize: number) => text.length * fontSize * 0.6;

/**
 * The first variant that fits `maxWidth`, else the last one shortened with
 * an ellipsis. `flag` is an emoji: several UTF-16 units, about 1.4 em wide
 * with its space, so it's measured apart.
 */
const fitLabel = (variants: string[], maxWidth: number, fontSize: number, flag = '') => {
  const withFlag = (text: string) => (flag ? `${flag} ${text}` : text);
  const room = maxWidth - (flag ? fontSize * 1.4 : 0);
  for (const variant of variants) {
    if (textWidth(variant, fontSize) <= room) return withFlag(variant);
  }
  const last = variants[variants.length - 1];
  const chars = Math.max(4, Math.floor(room / (fontSize * 0.6)) - 1);
  return withFlag(last.length > chars ? `${last.slice(0, chars)}…` : last);
};

// A region's faint tint for its parcels (neutral grey for an unknown region).
const parcelTint = (region: string | null) => {
  const hue = regionHue(region);
  return (alpha: number) => (hue === null ? `hsl(240 5% 65% / ${alpha})` : `hsl(${hue} 80% 68% / ${alpha})`);
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

const clampScale = (value: number) => Math.max(0.2, Math.min(3.2, value));

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
  const [geoByIp, setGeoByIp] = useState<Record<string, GeoInfo | null>>({});
  const [geoOverrides, setGeoOverrides] = useState<Record<string, GeoOverride>>({});
  const [geoDirtyByNodeId, setGeoDirtyByNodeId] = useState<Record<string, boolean>>({});
  const [geoSavingByNodeId, setGeoSavingByNodeId] = useState<Record<string, boolean>>({});
  const [nodePositionOverrides, setNodePositionOverrides] = useState<Record<string, { x: number; y: number }>>({});
  const [mapLocationOverrides, setMapLocationOverrides] = useState<Record<string, [number, number]>>({});
  const [mapView, setMapView] = useState<'map' | 'graph'>('map');
  const [selectedMapNodeId, setSelectedMapNodeId] = useState<string | null>(null);
  const [viewTransform, setViewTransform] = useState({ scale: 1, tx: 0, ty: 0 });
  const [testDraft, setTestDraft] = useState<{ from?: string; to?: string; type: TestType }>({ type: 'ping' });
  const [locationsOpen, setLocationsOpen] = useState(false);
  const [historyRange, setHistoryRange] = useState<'1h' | '24h' | '7d'>('1h');
  const [reportPair, setReportPair] = useState<{ a: string; b: string } | null>(null);
  // Opens on the topology, which is what the page is for; the connectivity
  // test form now waits in its own tab instead of greeting every visit.
  const [networkTab, setNetworkTab] = useState('topology');
  const [historyForward, setHistoryForward] = useState<VlanConnectionHistory | null>(null);
  const [historyReverse, setHistoryReverse] = useState<VlanConnectionHistory | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; startTx: number; startTy: number } | null>(null);
  const nodeDragRef = useRef<{ pointerId: number; nodeId: string; offsetX: number; offsetY: number } | null>(null);
  // The graph's viewBox is the frame's real pixel size, so the fit below and
  // pointer maths are exact at any width (it used to be a fixed 1320×760
  // letterboxed into whatever space the card had).
  const [graphSize, setGraphSize] = useState({ width: 960, height: 520 });
  const graphResizeRef = useRef<ResizeObserver | null>(null);
  const graphFrameRef = useCallback((element: HTMLDivElement | null) => {
    graphResizeRef.current?.disconnect();
    graphResizeRef.current = null;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      if (width > 0 && height > 0) {
        setGraphSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
      }
    });
    observer.observe(element);
    graphResizeRef.current = observer;
  }, []);
  // Set once the user pans or zooms: from then on the view stays where they
  // put it, until the fleet's shape changes or they press "Recentrer".
  const userMovedViewRef = useRef(false);
  const lastFitSignatureRef = useRef<string | null>(null);
  const geocodeAttemptedRef = useRef<Set<string>>(new Set());
  const countryPersistAttemptedRef = useRef<Set<string>>(new Set());
  const [gatewaySavingByNodeId, setGatewaySavingByNodeId] = useState<Record<string, boolean>>({});





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
          const [status, conns] = await Promise.all([api.vlan.getStatus(vlanId), api.vlan.getConnections(vlanId)]);
          setVlanStatus(status);
          setConnections(conns.connections);
          setLastRefreshAt(new Date());
        } else {
          setVlanStatus(null);
          setConnections([]);
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

  // Mirrors planOverlayPeers's segmentation rule (apps/api/src/vlan/overlay-topology.ts):
  // same-region pairs (or unresolved region) stay full-mesh; cross-region pairs are only
  // physically peered when BOTH regions have an active gateway, and then only between
  // those two gateway nodes — every other cross-region pair has no direct WireGuard peer at all.
  const gatewayNodeIdByRegion = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of vlanStatus?.vlan.members ?? []) {
      if (member.region && member.gatewayActive) {
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
    const nodes: GraphNode[] = [];
    // Positions in the graph come from graph-layout (packed by region →
    // country → city); only the map's lat/lng are resolved here.
    for (const member of membersList) {
      const endpointHost = parseHostFromEndpoint(member.node?.externalIp || member.node?.overlayEndpoint);
      const geo = endpointHost ? geoByIp[endpointHost] : null;
      const override = geoOverrides[member.nodeId];
      const country = override?.country?.trim() || geo?.country || 'Pays inconnu';
      const city = override?.city?.trim() || geo?.city || 'Ville inconnue';
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
      } else if (
        typeof geo?.latitude === 'number' &&
        typeof geo?.longitude === 'number' &&
        geoIpMatchesManualLocation(override, geo)
      ) {
        lat = geo.latitude;
        lng = geo.longitude;
        isPositionApproximate = false;
      } else {
        // A manual location without coordinates (city not found, or
        // only the country set) lands on its country, never back on
        // the IP-based guess it was meant to correct.
        const centroid = countryCentroid(countryCode);
        [lat, lng] = centroid ?? [15, 10];
        isPositionApproximate = true;
      }
      nodes.push({
        id: member.nodeId,
        label: member.node?.name || member.nodeId.slice(0, 8),
        vlanIp: member.vlanIp,
        status: member.node?.status === 'online' ? 'online' : 'offline',
        city,
        country,
        countryCode,
        region: member.region ?? null,
        isGateway: Boolean(member.gatewayActive),
        x: 0,
        y: 0,
        lat,
        lng,
        isPositionApproximate,
      });
    }

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
  const layoutMembers: LayoutMember[] = useMemo(
    () =>
      graph.nodes.map((node) => ({
        id: node.id,
        region: node.region,
        country: node.country,
        countryCode: node.countryCode,
        city: node.city,
      })),
    [graph.nodes],
  );
  const graphSignature = useMemo(() => layoutSignature(layoutMembers), [layoutMembers]);
  // Regions are arranged for the frame's shape (a row on a wide card, a
  // column on a phone); bucketed so a few pixels of resize don't reshuffle.
  const graphAspect = Math.round((graphSize.width / graphSize.height) * 4) / 4;
  // Keyed on the signature: the ~5 s poll hands over new arrays every tick,
  // but the packing only has to change when the fleet's shape does.
  const defaultGraphPositions = useMemo(
    () => computeDefaultPositions(layoutMembers, graphAspect),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graphSignature, graphAspect],
  );
  // A dragged node is stored as an offset from its packed spot (graphX/Y),
  // not as an absolute point: it stays put relative to its parcel when other
  // nodes join or leave and the packing moves around it.
  const displayedNodes = useMemo(
    () =>
      graph.nodes.map((node) => {
        const base = defaultGraphPositions.get(node.id) ?? { x: 0, y: 0 };
        const offset = nodePositionOverrides[node.id] ?? persistedGraphPositions.get(node.id) ?? { x: 0, y: 0 };
        return { ...node, x: base.x + offset.x, y: base.y + offset.y };
      }),
    [graph.nodes, defaultGraphPositions, persistedGraphPositions, nodePositionOverrides],
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
  const parcels = useMemo(
    () => computeParcels(layoutMembers, new Map(displayedNodes.map((node) => [node.id, { x: node.x, y: node.y }]))),
    [layoutMembers, displayedNodes],
  );
  // Biggest first, so regions sit behind countries behind cities.
  const parcelsBackToFront = useMemo(() => [...parcels].reverse(), [parcels]);
  // Zoomed out to fit a big fleet, labels would shrink to unreadable: they
  // grow back in world units (up to a cap) to stay legible on screen.
  const labelBoost = Math.min(1 / viewTransform.scale, 1.6);
  const fitGraphView = useCallback(() => {
    const bounds = contentBounds(parcels, displayedNodes);
    // The legend wraps to two lines on a phone.
    if (bounds) setViewTransform(fitTransform(bounds, graphSize.width, graphSize.height, { bottom: graphSize.width < 520 ? 64 : 48 }));
  }, [parcels, displayedNodes, graphSize]);
  const fitGraphViewRef = useRef(fitGraphView);
  fitGraphViewRef.current = fitGraphView;
  // Centred and zoomed to fit on first display, whenever a node joins,
  // leaves or moves to another place, and on resize until the user takes
  // over the view themselves.
  useEffect(() => {
    if (mapView !== 'graph' || networkTab !== 'topology' || displayedNodes.length === 0) return;
    if (lastFitSignatureRef.current !== graphSignature) {
      lastFitSignatureRef.current = graphSignature;
      userMovedViewRef.current = false;
    }
    if (!userMovedViewRef.current) fitGraphViewRef.current();
  }, [graphSignature, graphSize.width, graphSize.height, mapView, networkTab, displayedNodes.length]);
  const recenterGraph = () => {
    userMovedViewRef.current = false;
    fitGraphView();
  };
  const nodeById = useMemo(() => new Map(displayedNodes.map((node) => [node.id, node])), [displayedNodes]);
  const shortName = useCallback(
    (nodeId: string) => {
      const label = nodeById.get(nodeId)?.label;
      return label ? shortHostname(label) : nodeId.slice(0, 8);
    },
    [nodeById],
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
      gateway: group.find((m) => m.gatewayActive) ?? group.find((m) => m.node?.overlayIsGateway) ?? null,
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
      label:
        historyRange === '7d'
          ? new Date(sample.createdAt).toLocaleString('fr-FR', { weekday: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })
          : new Date(sample.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
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
      x: ((clientX - rect.left) / rect.width) * graphSize.width,
      y: ((clientY - rect.top) / rect.height) * graphSize.height,
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
    userMovedViewRef.current = true;
    setViewTransform((prev) => {
      const nextScale = clampScale(prev.scale * factor);
      if (nextScale === prev.scale) return prev;
      const center = focus ?? { x: graphSize.width / 2, y: graphSize.height / 2 };
      const worldX = (center.x - prev.tx) / prev.scale;
      const worldY = (center.y - prev.ty) / prev.scale;
      return {
        scale: nextScale,
        tx: center.x - worldX * nextScale,
        ty: center.y - worldY * nextScale,
      };
    });
  };

  const handleMapWheel = (event: WheelEvent) => {
    event.preventDefault();
    const focus = toSvgPoint(event.clientX, event.clientY);
    if (!focus) return;
    const factor = Math.exp(-event.deltaY * 0.0016);
    zoomFrom(factor, focus);
  };
  const handleMapWheelRef = useRef(handleMapWheel);
  handleMapWheelRef.current = handleMapWheel;
  // Native, non-passive listener: React's onWheel is passive, so its
  // preventDefault() was ignored and the page scrolled along with the zoom.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || mapView !== 'graph') return;
    const listener = (event: WheelEvent) => handleMapWheelRef.current(event);
    svg.addEventListener('wheel', listener, { passive: false });
    return () => svg.removeEventListener('wheel', listener);
  }, [mapView, networkTab]);

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
      const base = defaultGraphPositions.get(dragState.nodeId) ?? { x: 0, y: 0 };
      setNodePositionOverrides((prev) => ({
        ...prev,
        [dragState.nodeId]: {
          x: world.x - dragState.offsetX - base.x,
          y: world.y - dragState.offsetY - base.y,
        },
      }));
      return;
    }

    if (!panRef.current || panRef.current.pointerId !== event.pointerId) return;
    const point = toSvgPoint(event.clientX, event.clientY);
    if (!point) return;
    userMovedViewRef.current = true;
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
    let cityNotFound = false;
    if (locationCity) {
      const geocoded = await geocodeCity(locationCity, locationCountry);
      if (geocoded) {
        locationLat = geocoded.lat;
        locationLng = geocoded.lng;
      } else {
        cityNotFound = true;
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
      if (cityNotFound) {
        setNotice({
          type: 'error',
          message: `Localisation enregistrée, mais « ${locationCity} » est introuvable sur la carte : le nœud est placé au centre du pays. Glissez-le sur la carte pour le mettre au bon endroit.`,
        });
      }
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

  const runTest = async (params: { from: string; to: string; type: TestType }) => {
    if (!vlanStatus) return;
    setTestRunning(true);
    try {
      const result = await api.vlan.runTest(vlanStatus.vlan.id, params.from, params.to, params.type);
      // Session only: the API doesn't keep these (see VlanController.runConnectionTest).
      setTests((prev) => [result.test, ...prev].slice(0, 20));
    } catch (error) {
      setNotice({ type: 'error', message: error instanceof Error ? error.message : 'Le test n’a pas pu être lancé.' });
    } finally {
      setTestRunning(false);
    }
  };

  const handleSetGateway = async (nodeId: string, role: 'primary' | 'backup' | null, previous: 'primary' | 'backup' | null) => {
    if (!vlanStatus) return;
    setGatewaySavingByNodeId((prev) => ({ ...prev, [nodeId]: true }));
    try {
      await api.vlan.setGateway(vlanStatus.vlan.id, nodeId, role);
      setNotice({
        type: 'success',
        message:
          role === 'primary'
            ? `${shortName(nodeId)} est maintenant la passerelle de sa région. Le maillage est recalculé sur les nœuds concernés.`
            : role === 'backup'
              ? `${shortName(nodeId)} est la passerelle de secours de sa région : elle prendra le relais si la passerelle tombe.`
              : previous === 'backup'
                ? `${shortName(nodeId)} n’est plus passerelle de secours.`
                : `${shortName(nodeId)} n’est plus passerelle : sa région repasse en maillage complet avec les autres.`,
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

  const linkSummaries = useMemo<LinkSummary[]>(
    () =>
      pairFlows.map((pair) => {
        const flows = [pair.forward, pair.reverse].filter((flow): flow is DirectedFlow => Boolean(flow));
        const worst = flows.reduce<LinkStatus>((acc, flow) => (STATUS_PRIORITY[flow.status] > STATUS_PRIORITY[acc] ? flow.status : acc), 'healthy');
        const latencies = flows.map((flow) => flow.latencyMs).filter((value): value is number => typeof value === 'number');
        const losses = flows.map((flow) => flow.packetLoss).filter((value): value is number => typeof value === 'number');
        return {
          key: pair.key,
          aId: pair.nodeAId,
          bId: pair.nodeBId,
          status: flows.length === 0 ? 'unknown' : worst,
          latencyMs: latencies.length ? latencies.reduce((acc, value) => acc + value, 0) / latencies.length : null,
          packetLoss: losses.length ? Math.max(...losses) : null,
        };
      }),
    [pairFlows],
  );
  const linkByKey = useMemo(() => new Map(linkSummaries.map((link) => [link.key, link])), [linkSummaries]);
  const linkBetween = useCallback((aId: string, bId: string) => linkByKey.get([aId, bId].sort().join('__')), [linkByKey]);

  const openHistory = (key: string) => {
    setSelectedPairKey(key);
    setNetworkTab('history');
  };
  const prepareTest = (from: string, to: string) => {
    setTestDraft((draft) => ({ ...draft, from, to }));
    setNetworkTab('diagnostics');
  };
  const hopLabel = useCallback(
    (ip: string | null) => {
      const member = ip ? memberByVlanIp.get(ip) : undefined;
      return member ? { name: shortName(member.nodeId), region: member.region ?? null, gateway: Boolean(member.gatewayActive) } : null;
    },
    [memberByVlanIp, shortName],
  );
  const locationRows = useMemo<LocationRow[]>(
    () =>
      orderedNodes.map((node) => {
        const override = geoOverrides[node.id] ?? {};
        return {
          nodeId: node.id,
          name: shortName(node.id),
          vlanIp: node.vlanIp,
          city: override.city ?? '',
          country: override.country ?? '',
          countryCode: override.countryCode ?? '',
          detected: detectedGeoByNodeId.get(node.id),
          region: memberByNodeId.get(node.id)?.region ?? null,
          saving: Boolean(geoSavingByNodeId[node.id]),
        };
      }),
    [orderedNodes, geoOverrides, detectedGeoByNodeId, memberByNodeId, geoSavingByNodeId, shortName],
  );

  // Counted per real link (both directions folded, relayed cross-region pairs
  // left out) so the tiles agree with the list below; the API's own counts
  // include pairs that only exist through the gateways.
  const stats = useMemo(
    () => ({
      total: linkSummaries.length,
      healthy: linkSummaries.filter((link) => link.status === 'healthy').length,
      degraded: linkSummaries.filter((link) => link.status === 'degraded').length,
      offline: linkSummaries.filter((link) => link.status === 'offline').length,
    }),
    [linkSummaries],
  );
  const healthyPercent = stats.total > 0 ? Math.round((stats.healthy / stats.total) * 100) : 100;

  const content = initialLoading ? (
    <div className="space-y-6">
      <StatRow className="xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <StatCardSkeleton key={index} />
        ))}
      </StatRow>
      <ChartCardSkeleton height="h-96" />
    </div>
  ) : !vlanStatus ? (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <Network className="h-8 w-8 text-muted-foreground" />
        <h3 className="text-lg font-semibold text-foreground">Pas encore de réseau privé</h3>
        <p className="max-w-md text-sm text-muted-foreground">
          Il se crée tout seul dès que le premier agent se connecte. Ajoutez un nœud depuis la page Nœuds : les liens et leurs mesures apparaîtront ici.
        </p>
      </CardContent>
    </Card>
  ) : (
    <div className="space-y-6 animate-fade-in">
      {notice && (
        <Callout variant={notice.type === 'error' ? 'danger' : 'success'}>
          <span className="flex items-start justify-between gap-3">
            {notice.message}
            <button type="button" onClick={() => setNotice(null)} aria-label="Fermer" className="shrink-0 opacity-70 hover:opacity-100">
              <X className="h-4 w-4" />
            </button>
          </span>
        </Callout>
      )}

      <StatRow className="xl:grid-cols-4">
        <Stat label="Nœuds dans le réseau" value={vlanStatus.memberCount} icon={Network} hint={vlanStatus.vlan.subnetCidr} />
        <Stat
          label="Liens sains"
          value={healthyPercent}
          unit="%"
          icon={RadioTower}
          tone={healthyPercent >= 99 ? 'ok' : healthyPercent >= 80 ? 'warn' : 'danger'}
          hint={`${stats.healthy} sur ${stats.total} liens`}
        />
        <Stat
          label="Liens dégradés"
          value={stats.degraded}
          icon={Gauge}
          tone={stats.degraded > 0 ? 'warn' : 'ok'}
          hint={stats.degraded > 0 ? 'Latence ou pertes élevées' : 'Aucun'}
        />
        <Stat
          label="Liens hors ligne"
          value={stats.offline}
          icon={Activity}
          tone={stats.offline > 0 ? 'danger' : 'ok'}
          hint={stats.offline > 0 ? 'Ne répondent plus' : 'Aucun'}
        />
      </StatRow>

      <Tabs value={networkTab} onValueChange={setNetworkTab} className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <TabsList className="w-auto flex-1">
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
              Diagnostic
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="topology" className="space-y-4">
          <SegmentationCard
            regions={regionSummaries}
            linkBetween={linkBetween}
            name={shortName}
            saving={gatewaySavingByNodeId}
            onSetGatewayRole={(nodeId, role, previous) => void handleSetGateway(nodeId, role, previous)}
            onOpenLocations={() => {
              setLocationsOpen(true);
              requestAnimationFrame(() => document.getElementById('network-locations')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
            }}
          />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(20rem,1fr)]">
            <Card className="overflow-hidden">
              <CardHeader>
                <Tabs value={mapView} onValueChange={(value) => setMapView(value === 'graph' ? 'graph' : 'map')}>
                  <TabsList variant="segmented">
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
                <div className="flex items-center gap-1.5">
                  {mapView === 'graph' && (
                    <>
                      <Button size="icon" variant="secondary" className="h-7 w-7" onClick={() => zoomFrom(1.16)} aria-label="Zoomer">
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="secondary" className="h-7 w-7" onClick={() => zoomFrom(1 / 1.16)} aria-label="Dézoomer">
                        <Minus className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="secondary" className="h-7 gap-1.5" onClick={recenterGraph}>
                        <LocateFixed className="h-3.5 w-3.5" />
                        Recentrer
                      </Button>
                    </>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex h-7 w-7 cursor-help items-center justify-center rounded-md text-muted-foreground hover:bg-surface-2">
                        <Info className="h-3.5 w-3.5" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      {mapView === 'map'
                        ? 'Molette pour zoomer, glisser le fond pour se déplacer, glisser un point pour corriger sa position. Les nœuds d’un même lieu sont regroupés tant que vous n’avez pas zoomé.'
                        : 'Les nœuds sont regroupés par région, puis par pays et par ville. Molette pour zoomer, glisser le fond pour se déplacer, glisser un nœud pour l’écarter (sa position est mémorisée). Cliquez un lien pour le sélectionner.'}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </CardHeader>
              <CardContent className="p-0 lg:p-0">
                {mapView === 'map' ? (
                  <WorldMap
                    nodes={worldMapNodes}
                    links={worldMapLinks}
                    onNodeDrag={handleMapNodeDrag}
                    onSelectNode={setSelectedMapNodeId}
                    className="h-[520px] w-full rounded-none border-0 xl:h-[600px]"
                  />
                ) : (
                  <div ref={graphFrameRef} className="relative h-[520px] overflow-hidden bg-surface-2/40 xl:h-[600px]">
                    <svg
                      ref={svgRef}
                      viewBox={`0 0 ${graphSize.width} ${graphSize.height}`}
                      className="h-full w-full touch-none select-none"
                      onPointerDown={handleMapPointerDown}
                      onPointerMove={handleMapPointerMove}
                      onPointerUp={endPointerInteraction}
                      onPointerCancel={endPointerInteraction}
                    >
                      <defs>
                        <pattern id="graph-grid" width={24} height={24} patternUnits="userSpaceOnUse">
                          <circle cx={1} cy={1} r={1} fill="hsl(var(--muted-foreground) / 0.12)" />
                        </pattern>
                      </defs>
                      <rect width="100%" height="100%" fill="url(#graph-grid)" />
                      <g transform={`translate(${viewTransform.tx} ${viewTransform.ty}) scale(${viewTransform.scale})`}>
                        {parcelsBackToFront.map((parcel) => {
                          const tint = parcelTint(parcel.region);
                          const isRegion = parcel.kind === 'region';
                          const isCountry = parcel.kind === 'country';
                          return (
                            <circle
                              key={parcel.id}
                              cx={parcel.x}
                              cy={parcel.y}
                              r={parcel.r}
                              fill={tint(isRegion ? 0.05 : isCountry ? 0.045 : 0.035)}
                              stroke={tint(isRegion ? 0.38 : isCountry ? 0.28 : 0.24)}
                              strokeWidth={isRegion ? 1.5 : 1}
                              strokeDasharray={parcel.kind === 'city' ? '4 5' : undefined}
                            />
                          );
                        })}
                        {graph.links.map((link) => {
                          const source = nodeById.get(link.sourceNodeId);
                          const target = nodeById.get(link.targetNodeId);
                          if (!source || !target) return null;
                          const isSelected = selectedPairKey === link.key;
                          const dimmed = selectedPairKey !== null && !isSelected;
                          // Links between two regions (gateway to gateway) bow out
                          // so they read apart from the regions' inner mesh; inner
                          // links curve slightly too, so lined-up nodes don't
                          // stack their links on one line through each other.
                          const crossRegion = source.region !== target.region;
                          const dx = target.x - source.x;
                          const dy = target.y - source.y;
                          const bow = crossRegion ? 0.18 : 0.1;
                          const controlX = (source.x + target.x) / 2 - dy * bow;
                          const controlY = (source.y + target.y) / 2 + dx * bow;
                          const d = `M ${source.x} ${source.y} Q ${controlX} ${controlY} ${target.x} ${target.y}`;
                          return (
                            <g
                              key={link.key}
                              data-link-clickable="true"
                              onClick={() => setSelectedPairKey(isSelected ? null : link.key)}
                              className="cursor-pointer"
                              opacity={dimmed ? 0.25 : 1}
                            >
                              {/* Wide invisible stroke: a 2 px line is hard to hit. */}
                              <path d={d} fill="none" stroke="transparent" strokeWidth={16} vectorEffect="non-scaling-stroke" />
                              <path
                                id={`path-${link.key}`}
                                d={d}
                                fill="none"
                                stroke={linkStroke(link.status)}
                                strokeWidth={isSelected ? 4.5 : crossRegion ? 3 : 2}
                                strokeDasharray={link.status === 'offline' ? '6 6' : undefined}
                                strokeLinecap="round"
                                vectorEffect="non-scaling-stroke"
                                style={{ filter: isSelected || crossRegion ? linkGlow(link.status) : undefined }}
                              />
                              {link.status !== 'offline' && (
                                <circle r={isSelected ? 5 : crossRegion ? 4 : 3} fill={linkStroke(link.status)}>
                                  <animateMotion dur={linkPulseDuration(link.latencyMs)} repeatCount="indefinite" rotate="auto">
                                    <mpath href={`#path-${link.key}`} />
                                  </animateMotion>
                                </circle>
                              )}
                              <title>
                                {shortName(source.id)} ↔ {shortName(target.id)}
                                {crossRegion ? ' · lien entre régions' : ''} · {LINK_STATUS[link.status].label} · {formatMs(link.latencyMs)} · perte{' '}
                                {formatPercent(link.packetLoss)}
                              </title>
                            </g>
                          );
                        })}
                        {/* Parcel labels above the links, so a line never crosses out a name. */}
                        {parcelsBackToFront.map((parcel) => {
                          const tint = parcelTint(parcel.region);
                          if (parcel.kind === 'region') {
                            const count = parcel.nodeIds.length;
                            const text = `${regionLabel(parcel.region)} · ${count} nœud${count > 1 ? 's' : ''}`;
                            const k = labelBoost;
                            const width = (text.length * 7 + 26) * k;
                            return (
                              <g key={parcel.id} className="pointer-events-none">
                                {/* Tag straddling the top edge, like a label on a parcel map. */}
                                <rect
                                  x={parcel.x - width / 2}
                                  y={parcel.y - parcel.r - 13 * k}
                                  width={width}
                                  height={26 * k}
                                  rx={13 * k}
                                  fill="hsl(var(--surface-1))"
                                  stroke={tint(0.5)}
                                  vectorEffect="non-scaling-stroke"
                                />
                                <text x={parcel.x} y={parcel.y - parcel.r + 4.5 * k} textAnchor="middle" fill={tint(0.95)} fontSize={12.5 * k} fontWeight={600}>
                                  {text}
                                </text>
                              </g>
                            );
                          }
                          const isCountry = parcel.kind === 'country';
                          // These sit in the parcel's padding band: grown less, or
                          // they'd spill onto the children below.
                          const k = Math.min(labelBoost, 1.3);
                          const fontSize = (isCountry ? 12 : 11) * k;
                          // Must fit the bubble's width near its top, or two
                          // neighbours' labels run into each other: drop the city,
                          // then shorten.
                          const flag = isCountry ? flagFromCountryCode(parcel.countryCode) : '';
                          const text = fitLabel([parcel.label, parcel.shortLabel], parcel.r * 1.9, fontSize, flag);
                          return (
                            <text
                              key={parcel.id}
                              x={parcel.x}
                              y={parcel.y - parcel.r + (isCountry ? 15 : 12) + 2 * k}
                              textAnchor="middle"
                              fill={isCountry ? 'hsl(var(--foreground) / 0.8)' : 'hsl(var(--muted-foreground))'}
                              fontSize={fontSize}
                              fontWeight={isCountry ? 500 : 400}
                              stroke="hsl(var(--surface-2))"
                              strokeWidth={3}
                              paintOrder="stroke"
                              className="pointer-events-none"
                            >
                              {text}
                            </text>
                          );
                        })}
                        {displayedNodes.map((node) => {
                          const name = shortName(node.id);
                          const selected = selectedPairKey !== null && selectedPairKey.split('__').includes(node.id);
                          const baseWidth = Math.max(name.length * 7, node.vlanIp.length * 6.2) + 16;
                          // Grown with the zoom-out, but never wider than the node's
                          // footprint: two neighbours' plates must not overlap.
                          const k = Math.max(1, Math.min(labelBoost, (NODE_FOOTPRINT_RADIUS * 2 - 8) / baseWidth));
                          const plateWidth = baseWidth * k;
                          const color = nodeFill(node.status);
                          return (
                            <g
                              key={node.id}
                              data-node-draggable="true"
                              onPointerDown={(event) => handleNodePointerDown(event, node.id)}
                              className="cursor-grab active:cursor-grabbing"
                            >
                              <title>
                                {node.label} · {node.vlanIp} · {node.city}, {node.country} · {node.status === 'online' ? 'en ligne' : 'hors ligne'}
                                {node.isGateway ? ' · passerelle de sa région' : ''}
                              </title>
                              {node.status === 'online' && (
                                <circle cx={node.x} cy={node.y} r={NODE_DISC_RADIUS + 7} fill={color} opacity={0.12} />
                              )}
                              <circle
                                cx={node.x}
                                cy={node.y}
                                r={NODE_DISC_RADIUS}
                                fill="hsl(var(--surface-1))"
                                stroke={selected ? 'hsl(var(--primary))' : color}
                                strokeWidth={selected ? 3.5 : 2.5}
                              />
                              <circle cx={node.x} cy={node.y} r={8} fill={color} />
                              {node.isGateway && (
                                // Diamond badge on the rim: this node carries its region's
                                // traffic to the other regions.
                                <g transform={`translate(${node.x + 16} ${node.y - 16})`}>
                                  <rect x={-7} y={-7} width={14} height={14} rx={2.5} transform="rotate(45)" fill="hsl(var(--primary))" stroke="hsl(var(--surface-1))" strokeWidth={2} />
                                </g>
                              )}
                              <rect
                                x={node.x - plateWidth / 2}
                                y={node.y + NODE_DISC_RADIUS + 6}
                                width={plateWidth}
                                height={34 * k}
                                rx={7 * k}
                                fill="hsl(var(--surface-1) / 0.92)"
                                stroke="hsl(var(--border))"
                                vectorEffect="non-scaling-stroke"
                              />
                              <text x={node.x} y={node.y + NODE_DISC_RADIUS + 6 + 14 * k} textAnchor="middle" fill="hsl(var(--foreground))" fontSize={12 * k} fontWeight={500}>
                                {name}
                              </text>
                              <text
                                x={node.x}
                                y={node.y + NODE_DISC_RADIUS + 6 + 28 * k}
                                textAnchor="middle"
                                fill="hsl(var(--muted-foreground))"
                                fontSize={10.5 * k}
                                className="font-mono"
                              >
                                {node.vlanIp}
                              </text>
                            </g>
                          );
                        })}
                      </g>
                    </svg>
                    {displayedNodes.length === 0 ? (
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
                        <Network className="h-6 w-6 text-muted-foreground" />
                        <p className="text-sm font-medium text-foreground">Aucun nœud dans le réseau privé</p>
                        <p className="max-w-xs text-xs text-muted-foreground">Les nœuds apparaissent ici, regroupés par région, dès qu’ils ont rejoint le réseau.</p>
                      </div>
                    ) : (
                      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-surface-1/90 px-2.5 py-1.5 text-2xs text-muted-foreground backdrop-blur">
                        <span className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-[#10b981]" />
                          En ligne
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-[#f43f5e]" />
                          Hors ligne
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rotate-45 rounded-[2px] bg-primary" />
                          Passerelle
                        </span>
                        <span className="flex items-center gap-1.5">
                          <svg width="18" height="8" viewBox="0 0 18 8" aria-hidden>
                            <path d="M1 7 Q9 -2 17 7" fill="none" stroke="rgba(52,211,153,0.8)" strokeWidth={2} />
                          </svg>
                          Lien entre régions
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <LinksPanel
              className="xl:max-h-[665px]"
              links={linkSummaries}
              name={shortName}
              selectedKey={selectedPairKey}
              onSelect={setSelectedPairKey}
              onShowHistory={openHistory}
              onTest={prepareTest}
            />
          </div>

          <LocationEditor
            rows={locationRows}
            open={locationsOpen}
            onOpenChange={setLocationsOpen}
            onChange={updateNodeGeoOverride}
            onSave={(nodeId) => void saveNodeGeoOverride(nodeId)}
            onAuto={(nodeId) => {
              updateNodeGeoOverride(nodeId, { city: '', country: '', countryCode: '' });
              void saveNodeGeoOverride(nodeId, true);
            }}
            onResetGraph={() => {
              setNodePositionOverrides({});
              for (const nodeId of persistedGraphPositions.keys()) {
                void api.nodes.update(nodeId, { graphX: null, graphY: null }).catch(() => {});
              }
            }}
          />
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>
                <Activity className="h-4 w-4 text-primary" />
                Historique d’un lien
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                {historyPair && (
                  <Select value={historyPair.key} onValueChange={setSelectedPairKey}>
                    <SelectTrigger className="h-8 w-auto min-w-[16rem] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {sortLinks(linkSummaries).map((link) => (
                        <SelectItem key={link.key} value={link.key}>
                          <span className="flex items-center gap-2">
                            <StatusDot tone={LINK_STATUS[link.status].tone} />
                            {shortName(link.aId)} ↔ {shortName(link.bId)}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Tabs value={historyRange} onValueChange={(value) => setHistoryRange(value as '1h' | '24h' | '7d')}>
                  <TabsList variant="segmented">
                    <TabsTrigger value="1h">1 h</TabsTrigger>
                    <TabsTrigger value="24h">24 h</TabsTrigger>
                    <TabsTrigger value="7d">7 j</TabsTrigger>
                  </TabsList>
                </Tabs>
                {historyPair && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => setReportPair({ a: historyPair.nodeAId, b: historyPair.nodeBId })}
                    title="Rapport à envoyer au support de l’hébergeur : IP publiques, pertes mesurées et trajet internet"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Rapport pour l’hébergeur
                  </Button>
                )}
              </div>
              <CardDescription>
                Latence et pertes mesurées en continu par les agents, dans chaque sens. La disponibilité compte la part des mesures où le lien répondait.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 pt-4">
              {historyPair ? (
                (
                  [
                    { flow: historyPair.forward, history: historyForward, chartData: historyForwardChartData },
                    { flow: historyPair.reverse, history: historyReverse, chartData: historyReverseChartData },
                  ] as const
                ).map(({ flow, history, chartData }, index) => {
                  const samples = history?.samples ?? [];
                  const latencies = samples.map((sample) => sample.latencyMs).filter((value): value is number => typeof value === 'number');
                  const avg = latencies.length ? latencies.reduce((acc, value) => acc + value, 0) / latencies.length : null;
                  const peak = latencies.length ? Math.max(...latencies) : null;
                  return flow ? (
                    <section key={index} className="space-y-3">
                      <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                        {shortName(flow.sourceNodeId)}
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                        {shortName(flow.targetNodeId)}
                        <StatusPill tone={LINK_STATUS[flow.status].tone} className="ml-1">
                          {LINK_STATUS[flow.status].label}
                        </StatusPill>
                      </p>
                      <div className="grid gap-3 lg:grid-cols-[12rem_minmax(0,1fr)]">
                        <div className="grid grid-cols-3 gap-2 lg:grid-cols-1">
                          <div className="rounded-lg border border-border bg-surface-2/50 px-3 py-2">
                            <p className="text-2xs text-muted-foreground">Disponibilité · {HISTORY_RANGE_LABELS[historyRange]}</p>
                            <p className={cn('text-xl font-semibold tabular-nums', history?.uptimePercent != null ? uptimeToneClass(history.uptimePercent) : 'text-muted-foreground')}>
                              {history?.uptimePercent != null ? `${history.uptimePercent} %` : '—'}
                            </p>
                          </div>
                          <div className="rounded-lg border border-border bg-surface-2/50 px-3 py-2">
                            <p className="text-2xs text-muted-foreground">Latence moyenne</p>
                            <p className="text-xl font-semibold tabular-nums text-foreground">{formatMs(avg)}</p>
                          </div>
                          <div className="rounded-lg border border-border bg-surface-2/50 px-3 py-2">
                            <p className="text-2xs text-muted-foreground">Pic de latence</p>
                            <p className="text-xl font-semibold tabular-nums text-foreground">{formatMs(peak)}</p>
                          </div>
                        </div>
                        <div className="rounded-lg border border-border p-3">
                          <ConnectionHistoryChart data={chartData} />
                        </div>
                      </div>
                    </section>
                  ) : (
                    <p key={index} className="text-xs text-muted-foreground">
                      Aucune mesure dans ce sens pour l’instant.
                    </p>
                  );
                })
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">Aucun lien mesuré pour l’instant.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <Zap className="h-4 w-4 text-primary" />
                Vue d’ensemble des liens
              </CardTitle>
              <CardDescription>Latence de chaque sens de chaque lien, en un coup d’œil. Une ligne par nœud source, une colonne par nœud cible.</CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <ConnectionMatrix
                nodeIds={orderedNodes.map((node) => node.id)}
                name={shortName}
                selectedKey={historyPair?.key ?? null}
                onSelect={(key) => {
                  setSelectedPairKey(key);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                cell={(from, to) => {
                  if (!isPhysicalLink(from, to) && !isPhysicalLink(to, from)) return { relayed: true };
                  const direct = connectionByDirection.get(`${from}__${to}`);
                  return { relayed: false, status: direct?.status, latencyMs: direct?.latencyMs, packetLoss: direct?.packetLoss };
                }}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="diagnostics">
          <DiagnosticsPanel
            members={vlanStatus.vlan.members ?? []}
            name={shortName}
            tests={tests}
            running={testRunning}
            draft={testDraft}
            onDraftChange={setTestDraft}
            onRun={() => testDraft.from && testDraft.to && void runTest({ from: testDraft.from, to: testDraft.to, type: testDraft.type })}
            onRerun={(test) => void runTest({ from: test.initiatorNodeId, to: test.targetNodeId, type: test.testType })}
            onClear={() => setTests([])}
            hopLabel={hopLabel}
          />
        </TabsContent>
      </Tabs>
      {vlanStatus && (
        <HostReportDialog
          vlanId={vlanStatus.vlan.id}
          nodeA={reportPair ? { id: reportPair.a, name: nodeById.get(reportPair.a)?.label ?? shortName(reportPair.a) } : null}
          nodeB={reportPair ? { id: reportPair.b, name: nodeById.get(reportPair.b)?.label ?? shortName(reportPair.b) } : null}
          onOpenChange={(open) => !open && setReportPair(null)}
        />
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Réseau privé"
        description="Le réseau chiffré (WireGuard) qui relie vos nœuds : son organisation par région, l’état de chaque lien et des tests à la demande."
        meta={
          <span className="inline-flex items-center gap-1.5 text-2xs text-muted-foreground">
            <RefreshCw className={cn('h-3 w-3', refreshing && 'animate-spin')} />
            {lastRefreshAt ? `Actualisé à ${lastRefreshAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Synchronisation…'}
          </span>
        }
      />
      {content}
    </div>
  );
}
