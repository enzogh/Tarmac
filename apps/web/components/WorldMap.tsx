'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { flagFromCountryCode } from '../lib/geo';
import { cn } from '../lib/utils';

export type WorldMapNode = {
  id: string;
  label: string;
  vlanIp: string;
  status: 'online' | 'offline' | 'degraded';
  city: string;
  country: string;
  countryCode: string | null;
  lat: number;
  lng: number;
  isPositionApproximate: boolean;
};

export type WorldMapLinkStatus = 'healthy' | 'degraded' | 'offline' | 'unknown';

export type WorldMapLink = {
  key: string;
  sourceNodeId: string;
  targetNodeId: string;
  status: WorldMapLinkStatus;
  latencyMs?: number | null;
};

type WorldMapProps = {
  nodes: WorldMapNode[];
  links?: WorldMapLink[];
  onNodeDrag?: (nodeId: string, lat: number, lng: number) => void;
  onSelectNode?: (nodeId: string) => void;
  className?: string;
};

// Below this zoom, nodes sharing (roughly) the same coordinates are shown as
// a single cluster badge instead of overlapping pins — see spreadPosition
// for why a fixed degree-radius ring naturally grows on screen as you zoom
// past this threshold, without needing per-frame pixel recomputation.
const CLUSTER_ZOOM_THRESHOLD = 9;
const RING_RADIUS_DEG = 0.05;

// Shown only before the first fleet position is known (empty VLAN, still
// loading). As soon as there's at least one node, BoundsFitter takes over
// and frames the view on wherever the fleet actually is.
const DEFAULT_CENTER: [number, number] = [46.6, 2.4];
const DEFAULT_ZOOM = 6;

// How close the auto-fit is allowed to zoom in: a single node, or several
// nodes clustered in the same city, shouldn't fly in past street level.
const AUTOFIT_MAX_ZOOM = 12;
const AUTOFIT_SINGLE_NODE_ZOOM = 11;
const AUTOFIT_PADDING: [number, number] = [56, 56];

const STATUS_COLOR: Record<WorldMapNode['status'], string> = {
  online: '#34d399',
  degraded: '#fbbf24',
  offline: '#fb7185',
};

const LINK_STATUS_COLOR: Record<WorldMapLinkStatus, string> = {
  healthy: '#34d399',
  degraded: '#fbbf24',
  offline: '#fb7185',
  unknown: '#a1a1aa',
};

const LINK_STATUS_RANK: Record<WorldMapLinkStatus, number> = {
  healthy: 0,
  unknown: 1,
  degraded: 2,
  offline: 3,
};

// Same easing as the topology graph tab: a slower pulse for a laggier link,
// clamped so it never feels frozen or frantic.
function linkPulseDurationMs(latencyMs?: number | null) {
  if (typeof latencyMs !== 'number' || latencyMs <= 0) return 3000;
  return Math.max(900, Math.min(5000, latencyMs * 18));
}

// One small glowing dot per link status, built once — the flow layer swaps
// positions every animation frame, so the icon itself must stay a cheap,
// stable reference rather than being rebuilt 60 times a second.
const FLOW_MARKER_ICONS: Record<WorldMapLinkStatus, L.DivIcon> = Object.fromEntries(
  (Object.keys(LINK_STATUS_COLOR) as WorldMapLinkStatus[]).map((status) => {
    const color = LINK_STATUS_COLOR[status];
    return [
      status,
      L.divIcon({
        className: 'tarmac-map-marker',
        html: `<span style="display:block;width:7px;height:7px;border-radius:999px;background:${color};box-shadow:0 0 6px ${color}cc;"></span>`,
        iconSize: [7, 7],
        iconAnchor: [3.5, 3.5],
      }),
    ];
  }),
) as Record<WorldMapLinkStatus, L.DivIcon>;

function statusRank(status: WorldMapNode['status']) {
  if (status === 'offline') return 2;
  if (status === 'degraded') return 1;
  return 0;
}

function worstStatusOf(group: WorldMapNode[]): WorldMapNode['status'] {
  return group.reduce<WorldMapNode['status']>(
    (worst, node) => (statusRank(node.status) > statusRank(worst) ? node.status : worst),
    'online',
  );
}

function groupKey(node: WorldMapNode) {
  return `${node.lat.toFixed(2)},${node.lng.toFixed(2)}`;
}

function spreadPosition(group: WorldMapNode[], index: number): [number, number] {
  if (group.length === 1) return [group[0].lat, group[0].lng];
  const centerLat = group.reduce((sum, n) => sum + n.lat, 0) / group.length;
  const centerLng = group.reduce((sum, n) => sum + n.lng, 0) / group.length;
  const radius = RING_RADIUS_DEG + Math.max(0, group.length - 2) * 0.01;
  const angle = (index / group.length) * Math.PI * 2 - Math.PI / 2;
  const latOffset = radius * Math.sin(angle);
  const lngOffset = (radius * Math.cos(angle)) / Math.max(Math.cos((centerLat * Math.PI) / 180), 0.15);
  return [centerLat + latOffset, centerLng + lngOffset];
}

function nodeDivIcon(node: WorldMapNode, selected: boolean) {
  const color = STATUS_COLOR[node.status];
  const size = selected ? 18 : 14;
  const pulse =
    node.status === 'online'
      ? `<span style="position:absolute;inset:0;border-radius:999px;background:${color};opacity:0.55;animation:tarmac-map-ping 1.8s cubic-bezier(0,0,0.2,1) infinite;"></span>`
      : '';
  return L.divIcon({
    className: 'tarmac-map-marker',
    html: `<span style="position:relative;display:flex;width:${size}px;height:${size}px;">
      ${pulse}
      <span style="position:relative;display:block;width:100%;height:100%;border-radius:999px;background:#09090b;border:2.5px solid ${color};box-shadow:0 0 8px ${color}99;"></span>
    </span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function clusterDivIcon(count: number, worst: WorldMapNode['status']) {
  const color = STATUS_COLOR[worst];
  const size = 34;
  return L.divIcon({
    className: 'tarmac-map-marker',
    html: `<span style="display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:999px;background:rgba(9,9,11,0.92);border:2.5px solid ${color};box-shadow:0 0 10px ${color}80;color:#f4f4f5;font:600 12px ui-sans-serif,system-ui,sans-serif;">${count}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function ZoomTracker({ onZoom }: { onZoom: (zoom: number) => void }) {
  const map = useMapEvents({
    zoomend: () => onZoom(map.getZoom()),
  });
  useEffect(() => {
    onZoom(map.getZoom());
  }, [map, onZoom]);
  return null;
}

// Frames the view on wherever the fleet actually is: tight around a single
// city if every node is local, wide enough to cover both sides of the
// Atlantic once a node shows up on another continent — and everything in
// between, automatically, as the fleet grows. Only re-flies when the set of
// node positions actually changes, so it never fights a user who's mid-pan
// or mid-zoom just because a 5s poll re-rendered the same coordinates.
function BoundsFitter({ nodes }: { nodes: WorldMapNode[] }) {
  const map = useMap();
  const lastSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (nodes.length === 0) return;

    const signature = nodes
      .map((node) => `${node.lat.toFixed(3)},${node.lng.toFixed(3)}`)
      .sort()
      .join('|');
    if (signature === lastSignatureRef.current) return;
    lastSignatureRef.current = signature;

    if (nodes.length === 1) {
      map.flyTo([nodes[0].lat, nodes[0].lng], AUTOFIT_SINGLE_NODE_ZOOM, { duration: 0.8 });
      return;
    }

    const bounds = L.latLngBounds(nodes.map((node): [number, number] => [node.lat, node.lng]));
    map.flyToBounds(bounds, { padding: AUTOFIT_PADDING, maxZoom: AUTOFIT_MAX_ZOOM, duration: 0.8 });
  }, [nodes, map]);

  return null;
}

type ResolvedLink = WorldMapLink & { source: [number, number]; target: [number, number] };

// One shared animation loop drives every link's traveling dot at once
// (instead of one requestAnimationFrame per link), matching the pulse effect
// on the topology graph tab. Offline links never get a dot — same rule as
// the graph view.
function LinkFlowMarkers({ links }: { links: ResolvedLink[] }) {
  const [progressByKey, setProgressByKey] = useState<Record<string, number>>({});
  const animated = useMemo(() => links.filter((link) => link.status !== 'offline'), [links]);

  useEffect(() => {
    if (animated.length === 0) return;
    let frame = 0;
    const tick = (timestamp: number) => {
      const next: Record<string, number> = {};
      for (const link of animated) {
        const duration = linkPulseDurationMs(link.latencyMs);
        next[link.key] = (timestamp % duration) / duration;
      }
      setProgressByKey(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animated]);

  return (
    <>
      {animated.map((link) => {
        const t = progressByKey[link.key] ?? 0;
        const lat = link.source[0] + (link.target[0] - link.source[0]) * t;
        const lng = link.source[1] + (link.target[1] - link.source[1]) * t;
        return (
          <Marker
            key={`flow-${link.key}`}
            position={[lat, lng]}
            icon={FLOW_MARKER_ICONS[link.status]}
            interactive={false}
            keyboard={false}
          />
        );
      })}
    </>
  );
}

function ClusterMarker({
  lat,
  lng,
  count,
  worst,
  label,
}: {
  lat: number;
  lng: number;
  count: number;
  worst: WorldMapNode['status'];
  label: string;
}) {
  const map = useMap();
  return (
    <Marker
      position={[lat, lng]}
      icon={clusterDivIcon(count, worst)}
      eventHandlers={{
        click: () => map.flyTo([lat, lng], CLUSTER_ZOOM_THRESHOLD + 2, { duration: 0.6 }),
      }}
    >
      <Tooltip direction="top" offset={[0, -10]} opacity={1}>
        {count} nœuds · {label}
      </Tooltip>
    </Marker>
  );
}

function NodePopup({ node }: { node: WorldMapNode }) {
  return (
    <div className="min-w-[190px] font-sans">
      <p className="text-sm font-semibold text-zinc-100">{node.label}</p>
      <p className="mt-0.5 text-xs text-zinc-400">
        {flagFromCountryCode(node.countryCode)} {node.city}
        {node.country ? `, ${node.country}` : ''}
      </p>
      <p className="mt-1.5 font-mono text-[11px] text-zinc-400">{node.vlanIp}</p>
      {node.isPositionApproximate && (
        <p className="mt-2 text-[10px] leading-snug text-amber-300">
          Position approximative (pays détecté) — glissez le point pour la préciser.
        </p>
      )}
    </div>
  );
}

export function WorldMap({ nodes, links = [], onNodeDrag, onSelectNode, className }: WorldMapProps) {
  const [zoom, setZoom] = useState(4);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const groups = useMemo(() => {
    const byKey = new Map<string, WorldMapNode[]>();
    for (const node of nodes) {
      const key = groupKey(node);
      const list = byKey.get(key) ?? [];
      list.push(node);
      byKey.set(key, list);
    }
    return Array.from(byKey.values());
  }, [nodes]);

  // Single source of truth for "where does this node actually render right
  // now" — individually spread out, or collapsed into its cluster's center —
  // shared by both the node markers and the link lines so a line always
  // touches exactly where its endpoint marker is drawn.
  const resolvedPositionByNodeId = useMemo(() => {
    const map = new Map<string, [number, number]>();
    for (const group of groups) {
      const showIndividually = group.length === 1 || zoom >= CLUSTER_ZOOM_THRESHOLD;
      if (showIndividually) {
        group.forEach((node, index) => {
          map.set(node.id, spreadPosition(group, index));
        });
      } else {
        const centerLat = group.reduce((sum, n) => sum + n.lat, 0) / group.length;
        const centerLng = group.reduce((sum, n) => sum + n.lng, 0) / group.length;
        group.forEach((node) => map.set(node.id, [centerLat, centerLng]));
      }
    }
    return map;
  }, [groups, zoom]);

  // Two links whose endpoints collapse to the same cluster centers (e.g. two
  // different node pairs both starting in the same "3 nodes in Paris" badge)
  // would otherwise draw duplicate overlapping lines — dedupe by resolved
  // position pair and keep the worst status, same "worst wins" rule the
  // matrix/graph views already use.
  const resolvedLinks = useMemo(() => {
    const byPositionPair = new Map<string, ResolvedLink>();
    for (const link of links) {
      const source = resolvedPositionByNodeId.get(link.sourceNodeId);
      const target = resolvedPositionByNodeId.get(link.targetNodeId);
      if (!source || !target) continue;
      if (Math.abs(source[0] - target[0]) < 1e-6 && Math.abs(source[1] - target[1]) < 1e-6) continue;

      const pairKey = [source, target]
        .map((point) => point.map((value) => value.toFixed(4)).join(','))
        .sort()
        .join('__');
      const existing = byPositionPair.get(pairKey);
      if (!existing || LINK_STATUS_RANK[link.status] > LINK_STATUS_RANK[existing.status]) {
        byPositionPair.set(pairKey, { ...link, source, target });
      }
    }
    return Array.from(byPositionPair.values());
  }, [links, resolvedPositionByNodeId]);

  return (
    <div className={cn('tarmac-map overflow-hidden rounded-xl border border-white/[0.08]', className)}>
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        minZoom={2}
        maxZoom={17}
        scrollWheelZoom
        worldCopyJump
        className="h-full w-full"
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />
        <ZoomTracker onZoom={setZoom} />
        <BoundsFitter nodes={nodes} />
        {resolvedLinks.map((link) => (
          <Polyline
            key={link.key}
            positions={[link.source, link.target]}
            pathOptions={{
              color: LINK_STATUS_COLOR[link.status],
              weight: link.status === 'offline' ? 1.5 : 2.5,
              opacity: link.status === 'offline' ? 0.5 : 0.85,
              dashArray: link.status === 'offline' ? '6 6' : undefined,
              className: `tarmac-map-link-${link.status}`,
            }}
            interactive={false}
          />
        ))}
        <LinkFlowMarkers links={resolvedLinks} />
        {groups.map((group) => {
          const showIndividually = group.length === 1 || zoom >= CLUSTER_ZOOM_THRESHOLD;
          if (showIndividually) {
            return group.map((node, index) => {
              const [lat, lng] = resolvedPositionByNodeId.get(node.id) ?? spreadPosition(group, index);
              return (
                <Marker
                  key={node.id}
                  position={[lat, lng]}
                  icon={nodeDivIcon(node, selectedId === node.id)}
                  draggable={Boolean(onNodeDrag)}
                  eventHandlers={{
                    click: () => {
                      setSelectedId(node.id);
                      onSelectNode?.(node.id);
                    },
                    dragend: (event) => {
                      const marker = event.target as L.Marker;
                      const position = marker.getLatLng();
                      onNodeDrag?.(node.id, position.lat, position.lng);
                    },
                  }}
                >
                  <Tooltip direction="top" offset={[0, -10]} opacity={1}>
                    {node.label}
                  </Tooltip>
                  <Popup>
                    <NodePopup node={node} />
                  </Popup>
                </Marker>
              );
            });
          }

          const centerLat = group.reduce((sum, n) => sum + n.lat, 0) / group.length;
          const centerLng = group.reduce((sum, n) => sum + n.lng, 0) / group.length;
          return (
            <ClusterMarker
              key={`cluster-${groupKey(group[0])}`}
              lat={centerLat}
              lng={centerLng}
              count={group.length}
              worst={worstStatusOf(group)}
              label={group[0].city}
            />
          );
        })}
      </MapContainer>
    </div>
  );
}
