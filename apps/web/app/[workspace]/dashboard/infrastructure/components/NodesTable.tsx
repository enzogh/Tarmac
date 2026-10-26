'use client';

import { ArrowDown, ArrowUp, ArrowUpDown, BellOff, Eye, MoreHorizontal, Pencil, RefreshCcw, Thermometer, Trash2, Bell } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { NODE_STATUS, StatusDot, describe } from '@/components/ui/status';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { NodeActivityItem } from '@/lib/api';
import { formatCapacity, formatRelative, formatThroughput } from '@/lib/format';
import { flagFromCountryCode, GeoInfo } from '@/lib/geo';
import { cn } from '@/lib/utils';
import { cpuModelShort, cpuShape, memoryUsage } from '@/lib/system-info';
import { externalIpOf, formatDateTime, InternalDnsBadge, InternalDnsState, isMuted, MiniMeter, smartIssue, SwapLine } from './node-ui';

export type NodeAction = 'open' | 'edit' | 'update' | 'mute' | 'delete';
export type NodeSortKey = 'status' | 'name' | 'location' | 'cpu' | 'ram' | 'disk' | 'network' | 'seen';
export type NodeSort = { key: NodeSortKey; direction: 'asc' | 'desc' };

function SortHead({
  label,
  column,
  sort,
  onSort,
  className,
}: {
  label: string;
  column: NodeSortKey;
  sort: NodeSort;
  onSort: (key: NodeSortKey) => void;
  className?: string;
}) {
  const active = sort.key === column;
  const Icon = !active ? ArrowUpDown : sort.direction === 'asc' ? ArrowUp : ArrowDown;
  return (
    <TableHead className={className} aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(column)} className={cn('inline-flex items-center gap-1 hover:text-foreground', active && 'text-foreground')}>
        {label}
        <Icon className={cn('h-3 w-3', !active && 'opacity-40')} />
      </button>
    </TableHead>
  );
}

export function NodesTable({
  nodes,
  geo,
  labels,
  sort,
  onSort,
  internalDns,
  updatingIds,
  activeId,
  onAction,
}: {
  nodes: NodeActivityItem[];
  geo: (node: NodeActivityItem) => GeoInfo | null;
  labels: Record<string, string[]>;
  sort: NodeSort;
  onSort: (key: NodeSortKey) => void;
  internalDns: InternalDnsState | undefined;
  updatingIds: Set<string>;
  activeId: string | null;
  onAction: (node: NodeActivityItem, action: NodeAction) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <SortHead label="Nœud" column="name" sort={sort} onSort={onSort} />
          <SortHead label="État" column="status" sort={sort} onSort={onSort} />
          <SortHead label="Localisation" column="location" sort={sort} onSort={onSort} className="hidden lg:table-cell" />
          <TableHead className="hidden 2xl:table-cell">Adresses</TableHead>
          <SortHead label="CPU" column="cpu" sort={sort} onSort={onSort} className="hidden md:table-cell" />
          <SortHead label="RAM · swap" column="ram" sort={sort} onSort={onSort} className="hidden md:table-cell" />
          <SortHead label="Disque" column="disk" sort={sort} onSort={onSort} className="hidden md:table-cell" />
          <SortHead label="Réseau" column="network" sort={sort} onSort={onSort} className="hidden min-[1800px]:table-cell" />
          <TableHead className="hidden min-[1440px]:table-cell">Agent</TableHead>
          <SortHead label="Vu" column="seen" sort={sort} onSort={onSort} className="hidden sm:table-cell" />
          <TableHead className="sticky right-0 w-12 bg-card">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {nodes.map((node) => {
          const status = describe(NODE_STATUS, node.status);
          const location = geo(node);
          const nodeLabels = labels[node.id] ?? [];
          const isDnsNode = internalDns?.internalDnsNodeId === node.id;
          const offline = node.status === 'offline';
          const updating = updatingIds.has(node.id);
          return (
            <TableRow
              key={node.id}
              onClick={() => onAction(node, 'open')}
              className={cn('cursor-pointer', activeId === node.id && 'bg-primary/[0.06]')}
            >
              <TableCell className="max-w-[9.5rem] py-2 sm:max-w-[15rem]">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-medium text-foreground" title={node.name}>
                    {node.name}
                  </span>
                  {isDnsNode && internalDns && <InternalDnsBadge status={internalDns.internalDnsStatus} compact />}
                  {node.overlayIsGateway && (
                    <span className="rounded border border-border px-1 py-px text-2xs text-muted-foreground" title="Passerelle inter-régions du réseau privé">
                      GW
                    </span>
                  )}
                </div>
                <div className="flex min-w-0 items-center gap-1 text-2xs text-muted-foreground">
                  <span className="capitalize">{node.role}</span>
                  {nodeLabels.slice(0, 3).map((label) => (
                    <span key={label} className="shrink-0 rounded bg-surface-3 px-1.5 py-px">
                      {label}
                    </span>
                  ))}
                </div>
              </TableCell>
              <TableCell className="py-2">
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-foreground">
                  <StatusDot tone={status.tone} pulse={node.status === 'online'} />
                  {status.label}
                  {isMuted(node) && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <BellOff className="h-3 w-3 text-[hsl(var(--warn))]" />
                      </TooltipTrigger>
                      <TooltipContent>Alertes en silence jusqu’à {formatDateTime(node.mutedUntil)}</TooltipContent>
                    </Tooltip>
                  )}
                  {smartIssue(node) && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Thermometer className="h-3 w-3 text-[hsl(var(--danger))]" />
                      </TooltipTrigger>
                      <TooltipContent>Un disque signale une anomalie SMART</TooltipContent>
                    </Tooltip>
                  )}
                </span>
              </TableCell>
              <TableCell className="hidden max-w-[11rem] py-2 text-xs lg:table-cell">
                {location ? (
                  <span className="flex items-center gap-1.5 truncate">
                    <span className="text-sm leading-none">{flagFromCountryCode(location.countryCode)}</span>
                    <span className="truncate text-foreground">{location.city || location.country || '—'}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="hidden py-2 font-mono text-2xs 2xl:table-cell">
                <div className="text-foreground">{externalIpOf(node) ?? '—'}</div>
                <div className="text-muted-foreground">{node.vlanIp ?? 'hors réseau privé'}</div>
              </TableCell>
              <TableCell className="hidden py-2 md:table-cell">
                {offline ? (
                  <span className="text-2xs text-muted-foreground">—</span>
                ) : (
                  <>
                    <MiniMeter value={node.metrics.cpu} title={[cpuModelShort(node.systemInfo), cpuShape(node.systemInfo)].filter(Boolean).join(' · ') || undefined} />
                    {node.systemInfo?.cpuThreads && (
                      <span className="mt-0.5 block text-2xs text-muted-foreground">{node.systemInfo.cpuThreads} threads</span>
                    )}
                  </>
                )}
              </TableCell>
              <TableCell className="hidden py-2 md:table-cell">
                {offline ? (
                  <span className="text-2xs text-muted-foreground">—</span>
                ) : (
                  <>
                    <MiniMeter value={node.metrics.ram} title={memoryUsage(node.systemInfo, node.metrics.ram)?.label} />
                    <SwapLine info={node.systemInfo} className="mt-1" />
                  </>
                )}
              </TableCell>
              <TableCell className="hidden py-2 md:table-cell">
                <MiniMeter
                  value={node.storage.usageRatio * 100}
                  title={`${formatCapacity(node.storage.totalUsedGb)} sur ${formatCapacity(node.storage.totalCapacityGb)}`}
                />
              </TableCell>
              <TableCell className="hidden whitespace-nowrap py-2 text-2xs tabular-nums text-muted-foreground min-[1800px]:table-cell">
                ↓ {formatThroughput(node.metrics.networkRx)}
                <br />↑ {formatThroughput(node.metrics.networkTx)}
              </TableCell>
              <TableCell className="hidden py-2 min-[1440px]:table-cell">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 whitespace-nowrap font-mono text-2xs',
                        node.agentUpToDate === false ? 'text-[hsl(var(--warn))]' : node.agentUpToDate ? 'text-muted-foreground' : 'text-muted-foreground/60',
                      )}
                    >
                      {updating && <RefreshCcw className="h-3 w-3 animate-spin" />}
                      {node.agentVersion ? node.agentVersion.slice(0, 7) : '—'}
                      {node.agentUpToDate === false && ' ↑'}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Agent : {node.agentVersion ?? 'jamais rapporté'}</p>
                    <p>Contrôleur : {node.controlVersion ?? '—'}</p>
                    {node.agentUpToDate === false && <p>Mise à jour disponible</p>}
                  </TooltipContent>
                </Tooltip>
              </TableCell>
              <TableCell className="hidden whitespace-nowrap py-2 text-2xs text-muted-foreground sm:table-cell" title={formatDateTime(node.lastSeenAt)}>
                {formatRelative(node.lastSeenAt)}
              </TableCell>
              <TableCell className="sticky right-0 bg-card py-2 text-right [tr:hover>&]:bg-surface-2" onClick={(event) => event.stopPropagation()}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Actions pour ${node.name}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuItem onSelect={() => onAction(node, 'open')} className="gap-2">
                      <Eye className="h-3.5 w-3.5" />
                      Détails, DNS et disques
                    </DropdownMenuItem>
                    <DropdownMenuItem write onSelect={() => onAction(node, 'edit')} className="gap-2">
                      <Pencil className="h-3.5 w-3.5" />
                      Renommer, rôle, libellés
                    </DropdownMenuItem>
                    <DropdownMenuItem write onSelect={() => onAction(node, 'update')} disabled={node.status !== 'online' || updating} className="gap-2">
                      <RefreshCcw className="h-3.5 w-3.5" />
                      Mettre à jour l’agent
                    </DropdownMenuItem>
                    <DropdownMenuItem write onSelect={() => onAction(node, 'mute')} className="gap-2">
                      {isMuted(node) ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
                      {isMuted(node) ? 'Réactiver les alertes' : 'Silence 1 h (maintenance)'}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem write onSelect={() => onAction(node, 'delete')} className="gap-2 text-[hsl(var(--danger))]">
                      <Trash2 className="h-3.5 w-3.5" />
                      Supprimer le nœud
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
