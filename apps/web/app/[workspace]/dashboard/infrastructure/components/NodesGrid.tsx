'use client';

import { BellOff, Thermometer } from 'lucide-react';
import { NODE_STATUS, StatusDot, describe } from '@/components/ui/status';
import type { NodeActivityItem } from '@/lib/api';
import { flagFromCountryCode, GeoInfo } from '@/lib/geo';
import { cn } from '@/lib/utils';
import { cpuShape, memoryUsage } from '@/lib/system-info';
import { InternalDnsBadge, InternalDnsState, isMuted, MiniMeter, nodeAttention, smartIssue } from './node-ui';

/**
 * Dense tiles for scanning a whole fleet at once: status by colour and
 * position, the three usage bars, and what needs a look.
 */
export function NodesGrid({
  nodes,
  geo,
  internalDns,
  activeId,
  onOpen,
}: {
  nodes: NodeActivityItem[];
  geo: (node: NodeActivityItem) => GeoInfo | null;
  internalDns: InternalDnsState | undefined;
  activeId: string | null;
  onOpen: (node: NodeActivityItem) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
      {nodes.map((node) => {
        const status = describe(NODE_STATUS, node.status);
        const location = geo(node);
        const attention = nodeAttention(node);
        const offline = node.status === 'offline';
        return (
          <button
            key={node.id}
            type="button"
            onClick={() => onOpen(node)}
            className={cn(
              'group relative overflow-hidden rounded-lg border bg-surface-1 p-3 text-left transition-colors hover:border-primary/40 hover:bg-surface-2/60',
              activeId === node.id ? 'border-primary/50 ring-1 ring-primary/30' : 'border-border',
            )}
          >
            <span
              className={cn(
                'absolute inset-y-0 left-0 w-0.5',
                node.status === 'online' ? 'bg-[hsl(var(--ok))]' : node.status === 'degraded' ? 'bg-[hsl(var(--warn))]' : 'bg-[hsl(var(--danger))]',
              )}
            />
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground" title={node.name}>
                  <StatusDot tone={status.tone} pulse={node.status === 'online'} />
                  <span className="truncate">{node.name}</span>
                </p>
                <p className="mt-0.5 truncate text-2xs text-muted-foreground">
                  {location ? `${flagFromCountryCode(location.countryCode)} ${location.city || location.country || ''}` : 'Localisation inconnue'}
                  {node.vlanIp && <span className="font-mono"> · {node.vlanIp}</span>}
                </p>
              </div>
              <span className="flex shrink-0 items-center gap-1">
                {internalDns?.internalDnsNodeId === node.id && <InternalDnsBadge status={internalDns.internalDnsStatus} compact />}
                {isMuted(node) && <BellOff className="h-3 w-3 text-[hsl(var(--warn))]" />}
                {smartIssue(node) && <Thermometer className="h-3 w-3 text-[hsl(var(--danger))]" />}
              </span>
            </div>
            <div className="mt-2.5 grid grid-cols-[2.5rem_1fr] items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
              <span>CPU</span>
              {offline ? <span>—</span> : <MiniMeter value={node.metrics.cpu} title={cpuShape(node.systemInfo) ?? undefined} />}
              <span>RAM</span>
              {offline ? <span>—</span> : <MiniMeter value={node.metrics.ram} title={memoryUsage(node.systemInfo, node.metrics.ram)?.label} />}
              <span>Disque</span>
              <MiniMeter value={node.storage.usageRatio * 100} />
            </div>
            {attention.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {attention.map((reason) => (
                  <span key={reason} className="rounded bg-[hsl(var(--warn))]/10 px-1.5 py-px text-2xs text-[hsl(var(--warn))]">
                    {reason}
                  </span>
                ))}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
