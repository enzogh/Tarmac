'use client';

import { useEffect, useMemo, useState } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Popup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
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

type WorldMapProps = {
  nodes: WorldMapNode[];
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

// This fleet is hosted mostly in France, so the map opens there by default
// (metropolitan France roughly fills the view at this zoom) rather than
// centering on whichever node happens to be first in the list.
const DEFAULT_CENTER: [number, number] = [46.6, 2.4];
const DEFAULT_ZOOM = 6;

const STATUS_COLOR: Record<WorldMapNode['status'], string> = {
  online: '#34d399',
  degraded: '#fbbf24',
  offline: '#fb7185',
};

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

export function WorldMap({ nodes, onNodeDrag, onSelectNode, className }: WorldMapProps) {
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
        {groups.map((group) => {
          const showIndividually = group.length === 1 || zoom >= CLUSTER_ZOOM_THRESHOLD;
          if (showIndividually) {
            return group.map((node, index) => {
              const [lat, lng] = spreadPosition(group, index);
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
