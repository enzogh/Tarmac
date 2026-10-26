'use client';

import { ArrowDown, ArrowRight, ArrowUp, ArrowUpDown, Download, Lock, MoreHorizontal, Pencil, Power, RotateCcw, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StatusDot, StatusPill } from '@/components/ui/status';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { VpnProfile } from '@/lib/api';
import { formatRelative, formatThroughput } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useReadOnly } from '@/lib/read-only';
import { AccessChips } from './access';
import { LiveSession, NodeFlag, profileStatus } from './vpn-ui';

export type ProfileAction = 'open' | 'install' | 'edit' | 'access' | 'toggle' | 'rotate' | 'delete';
export type SortKey = 'status' | 'name' | 'entry' | 'activity' | 'ip';
export type Sort = { key: SortKey; direction: 'asc' | 'desc' };

export function isLiveConnected(profile: VpnProfile, live?: LiveSession) {
  return (
    profile.session.connected ||
    Boolean(live?.lastHandshakeAt && Date.now() - new Date(live.lastHandshakeAt).getTime() < 180_000)
  );
}

function SortHead({ label, column, sort, onSort, className }: { label: string; column: SortKey; sort: Sort; onSort: (key: SortKey) => void; className?: string }) {
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

export function ProfileTable({
  profiles,
  live,
  selected,
  onSelectedChange,
  sort,
  onSort,
  nodeNames,
  profileNames,
  onAction,
  activeId,
}: {
  profiles: VpnProfile[];
  live: Record<string, LiveSession>;
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  sort: Sort;
  onSort: (key: SortKey) => void;
  nodeNames: Map<string, string>;
  profileNames: Map<string, string>;
  onAction: (profile: VpnProfile, action: ProfileAction) => void;
  activeId: string | null;
}) {
  const { readOnly } = useReadOnly();
  const allSelected = profiles.length > 0 && profiles.every((profile) => selected.has(profile.id));
  const someSelected = profiles.some((profile) => selected.has(profile.id));
  const toggleAll = () => {
    const next = new Set(selected);
    for (const profile of profiles) {
      if (allSelected) next.delete(profile.id);
      else next.add(profile.id);
    }
    onSelectedChange(next);
  };
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange(next);
  };

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-10">
            <Checkbox checked={allSelected} indeterminate={!allSelected && someSelected} onChange={toggleAll} aria-label="Sélectionner la page" />
          </TableHead>
          <SortHead label="Profil" column="name" sort={sort} onSort={onSort} />
          <SortHead label="Statut" column="status" sort={sort} onSort={onSort} />
          <SortHead label="Trajet" column="entry" sort={sort} onSort={onSort} className="hidden lg:table-cell" />
          <TableHead className="hidden xl:table-cell">Accès</TableHead>
          <SortHead label="Adresse" column="ip" sort={sort} onSort={onSort} className="hidden md:table-cell" />
          <SortHead label="Activité" column="activity" sort={sort} onSort={onSort} className="hidden sm:table-cell" />
          <TableHead className="w-24 text-right">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {profiles.map((profile) => {
          const status = profileStatus(profile);
          const session = live[profile.id];
          const connected = isLiveConnected(profile, session);
          const lastHandshakeAt = session?.lastHandshakeAt ?? profile.session.lastHandshakeAt;
          const usable = profile.deployment.status !== 'disabled' && profile.deployment.status !== 'expired';
          const isSelected = selected.has(profile.id);
          return (
            <TableRow
              key={profile.id}
              data-state={isSelected ? 'selected' : undefined}
              onClick={() => onAction(profile, 'open')}
              className={cn('cursor-pointer', !usable && 'opacity-60', activeId === profile.id && 'bg-primary/[0.06]')}
            >
              <TableCell className="py-2" onClick={(event) => event.stopPropagation()}>
                <Checkbox checked={isSelected} onChange={() => toggle(profile.id)} aria-label={`Sélectionner ${profile.name}`} />
              </TableCell>
              <TableCell className="max-w-[16rem] py-2">
                <div className="truncate font-medium text-foreground">{profile.name}</div>
                <div className="flex h-4 min-w-0 items-center gap-1">
                  {profile.tags.length === 0 && !profile.description && (
                    <span className="text-2xs text-muted-foreground/60">{profile.mode === 'full' ? 'VPN complet' : 'Réseau privé'}</span>
                  )}
                  {profile.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="shrink-0 rounded bg-surface-3 px-1.5 text-2xs leading-4 text-muted-foreground">
                      {tag}
                    </span>
                  ))}
                  {profile.tags.length > 3 && <span className="text-2xs text-muted-foreground">+{profile.tags.length - 3}</span>}
                  {profile.description && <span className="truncate text-2xs text-muted-foreground">{profile.description}</span>}
                </div>
              </TableCell>
              <TableCell className="py-2">
                <span className="inline-flex items-center gap-1.5">
                  {status.hint ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <StatusPill tone={status.tone}>{status.label}</StatusPill>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">{status.hint}</TooltipContent>
                    </Tooltip>
                  ) : (
                    <StatusPill tone={status.tone}>{status.label}</StatusPill>
                  )}
                  {profile.deployment.warning && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <TriangleAlert className="h-3.5 w-3.5 text-[hsl(var(--warn))]" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">{profile.deployment.warning}</TooltipContent>
                    </Tooltip>
                  )}
                </span>
              </TableCell>
              <TableCell className="hidden py-2 lg:table-cell">
                <span className="inline-flex max-w-[15rem] items-center gap-1.5 text-xs">
                  <NodeFlag node={profile.entryNode} className="text-sm" />
                  <span className="truncate text-foreground">{profile.entryNode.name}</span>
                  {profile.exitNode && profile.exitNode.id !== profile.entryNode.id && (
                    <>
                      <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <NodeFlag node={profile.exitNode} className="text-sm" />
                      <span className="truncate text-foreground">{profile.exitNode.name}</span>
                    </>
                  )}
                </span>
              </TableCell>
              <TableCell className="hidden py-2 xl:table-cell">
                <AccessChips profile={profile} nodeNames={nodeNames} profileNames={profileNames} />
              </TableCell>
              <TableCell className="hidden py-2 font-mono text-xs text-muted-foreground md:table-cell">{profile.clientIp}</TableCell>
              <TableCell className="hidden py-2 text-xs sm:table-cell">
                {connected && session ? (
                  <span className="inline-flex items-center gap-1.5 tabular-nums text-foreground">
                    <StatusDot tone="ok" pulse />↓ {formatThroughput(session.txRate)} · ↑ {formatThroughput(session.rxRate)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">{lastHandshakeAt ? formatRelative(lastHandshakeAt) : 'Jamais connecté'}</span>
                )}
              </TableCell>
              <TableCell className="py-2 text-right" onClick={(event) => event.stopPropagation()}>
                <span className="inline-flex items-center gap-0.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => onAction(profile, 'install')}
                        disabled={!usable || readOnly}
                        aria-label={`Installer ${profile.name}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground disabled:opacity-40"
                      >
                        {readOnly ? <Lock className="h-3.5 w-3.5" /> : <Download className="h-4 w-4" />}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{readOnly ? 'Lecture seule : l’installation donne accès aux clés de l’appareil.' : 'Installer sur l’appareil (fichier ou QR code)'}</TooltipContent>
                  </Tooltip>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={`Actions pour ${profile.name}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem write onSelect={() => onAction(profile, 'access')} className="gap-2">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Règles d&apos;accès
                      </DropdownMenuItem>
                      <DropdownMenuItem write onSelect={() => onAction(profile, 'edit')} className="gap-2">
                        <Pencil className="h-3.5 w-3.5" />
                        Modifier le profil
                      </DropdownMenuItem>
                      <DropdownMenuItem write onSelect={() => onAction(profile, 'toggle')} className="gap-2">
                        <Power className="h-3.5 w-3.5" />
                        {profile.enabled ? 'Désactiver' : 'Réactiver'}
                      </DropdownMenuItem>
                      <DropdownMenuItem write onSelect={() => onAction(profile, 'rotate')} className="gap-2">
                        <RotateCcw className="h-3.5 w-3.5" />
                        Régénérer les clés
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem write onSelect={() => onAction(profile, 'delete')} className="gap-2 text-[hsl(var(--danger))]">
                        <Trash2 className="h-3.5 w-3.5" />
                        Supprimer
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </span>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
