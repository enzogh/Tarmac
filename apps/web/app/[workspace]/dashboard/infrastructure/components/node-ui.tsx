'use client';

import { Globe, LoaderCircle } from 'lucide-react';
import type { NodeActivityItem } from '@/lib/api';
import { GeoInfo, normalizeCountryCode, parseHostFromEndpoint } from '@/lib/geo';
import { cn } from '@/lib/utils';

export type InternalDnsState = {
  internalDnsNodeId: string | null;
  internalDnsStatus: 'pending' | 'active' | 'error';
  internalDnsError?: string | null;
  records: Array<{ name: string; content: string }>;
};

export const formatDateTime = (value?: string | null) => (value ? new Date(value).toLocaleString('fr-FR') : '-');

export const externalIpOf = (node: NodeActivityItem) => parseHostFromEndpoint(node.externalIp || node.overlayEndpoint) ?? null;

// Location edited by hand (Réseau > nœud) always wins over the IP-based
// GeoIP lookup, which is only a fallback for nodes nobody has corrected yet.
export function nodeGeo(node: NodeActivityItem, geoByIp: Record<string, GeoInfo | null>): GeoInfo | null {
  const ip = externalIpOf(node);
  const auto = ip ? geoByIp[ip] : null;
  const hasOverride = Boolean(node.locationCity || node.locationCountry || node.locationCountryCode);
  if (!hasOverride && !auto) return null;
  return {
    ip: ip ?? auto?.ip ?? '',
    city: node.locationCity?.trim() || auto?.city || null,
    country: node.locationCountry?.trim() || auto?.country || null,
    countryCode: normalizeCountryCode(node.locationCountryCode) ?? auto?.countryCode ?? null,
    latitude: node.locationLat ?? auto?.latitude ?? null,
    longitude: node.locationLng ?? auto?.longitude ?? null,
  };
}

export const isMuted = (node: NodeActivityItem) => !!node.mutedUntil && new Date(node.mutedUntil).getTime() > Date.now();

export const smartIssue = (node: NodeActivityItem) =>
  node.smartMonitoringEnabled !== false && node.storage.disks.some((disk) => disk.smart && disk.smart.overall !== 'healthy');

/** A node needs a look: down, degraded, out-of-date agent, failing disk, or full. */
export function nodeAttention(node: NodeActivityItem): string[] {
  const reasons: string[] = [];
  if (node.status === 'offline') reasons.push('Hors ligne');
  if (node.status === 'degraded') reasons.push('Dégradé');
  if (node.agentUpToDate === false) reasons.push('Agent obsolète');
  if (smartIssue(node)) reasons.push('Disque SMART');
  if (node.storage.usageRatio >= 0.9) reasons.push('Stockage plein');
  if (node.internalDnsForwarderStatus === 'conflict') reasons.push('Conflit DNS');
  return reasons;
}

export const SMART_LABEL: Record<string, { label: string; type: 'success' | 'warning' | 'error' | 'info' }> = {
  healthy: { label: 'SMART OK', type: 'success' },
  warning: { label: 'SMART dégradé', type: 'warning' },
  critical: { label: 'SMART critique', type: 'error' },
  unknown: { label: 'SMART inconnu', type: 'info' },
};

const meterColor = (value: number) =>
  value >= 85 ? 'bg-[hsl(var(--danger))]' : value >= 65 ? 'bg-[hsl(var(--warn))]' : 'bg-[hsl(var(--ok))]';

/** Thin usage bar with its percentage, sized for a table cell. */
export function MiniMeter({ value, title, className }: { value: number; title?: string; className?: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <span className={cn('flex min-w-[4.5rem] items-center gap-2', className)} title={title}>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
        <span className={cn('block h-full rounded-full transition-[width] duration-500', meterColor(clamped))} style={{ width: `${clamped}%` }} />
      </span>
      <span className={cn('w-8 text-right text-2xs tabular-nums', clamped >= 85 ? 'text-[hsl(var(--danger))]' : 'text-muted-foreground')}>
        {Math.round(clamped)}%
      </span>
    </span>
  );
}

const DNS_TONE = {
  active: { label: 'DNS interne actif', className: 'border-[hsl(var(--ok))]/30 bg-[hsl(var(--ok))]/10 text-[hsl(var(--ok))]' },
  pending: { label: 'DNS interne : installation…', className: 'border-[hsl(var(--warn))]/30 bg-[hsl(var(--warn))]/10 text-[hsl(var(--warn))]' },
  error: { label: 'DNS interne en échec', className: 'border-[hsl(var(--danger))]/30 bg-[hsl(var(--danger))]/10 text-[hsl(var(--danger))]' },
} as const;

/** Shown on the one node designated as the fleet's internal DNS server. */
export function InternalDnsBadge({ status, compact }: { status: InternalDnsState['internalDnsStatus']; compact?: boolean }) {
  const tone = DNS_TONE[status];
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-2xs font-medium', tone.className)} title={tone.label}>
      {status === 'pending' ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <Globe className="h-3 w-3" />}
      {compact ? 'DNS' : tone.label}
    </span>
  );
}
