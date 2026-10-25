'use client';

import type { ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Clock,
  Download,
  MoreHorizontal,
  Pencil,
  Power,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusDot, StatusPill } from '@/components/ui/status';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { VpnGateway, VpnProfile } from '@/lib/api';
import { formatBytes, formatDateTime, formatRelative, formatThroughput } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ExitSwitcher } from './ExitSwitcher';
import { RouteDiagram } from './RouteDiagram';
import { endpointIp, LiveSession, MODE_LABEL, profileStatus } from './vpn-ui';

export type ProfileAction = 'install' | 'edit' | 'toggle' | 'rotate' | 'delete';

function Metric({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  return (
    <div className="min-w-0" title={title}>
      <dt className="text-2xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-xs text-foreground">{children}</dd>
    </div>
  );
}

export function ProfileCard({
  profile,
  gateways,
  live,
  switchingTo,
  flash,
  onSwitchExit,
  onAction,
}: {
  profile: VpnProfile;
  gateways: VpnGateway[];
  live?: LiveSession;
  switchingTo: string | null;
  /** Short-lived confirmation shown right after an exit switch. */
  flash?: string | null;
  onSwitchExit: (exitNodeId: string | null) => void;
  onAction: (action: ProfileAction) => void;
}) {
  const status = profileStatus(profile);
  const lastHandshakeAt = live?.lastHandshakeAt ?? profile.session.lastHandshakeAt;
  const endpoint = live?.endpoint ?? profile.session.endpoint;
  const connected =
    profile.session.connected ||
    Boolean(live?.lastHandshakeAt && Date.now() - new Date(live.lastHandshakeAt).getTime() < 180_000);
  const usable = profile.deployment.status !== 'disabled' && profile.deployment.status !== 'expired';

  return (
    <Card className={cn('overflow-hidden', !usable && 'opacity-70')}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 lg:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-foreground">{profile.name}</h3>
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
            <Badge variant="secondary">{MODE_LABEL[profile.mode].short}</Badge>
            {profile.expiresAt && profile.deployment.status !== 'expired' && (
              <Badge variant="outline" className="gap-1">
                <Clock className="h-3 w-3" />
                Expire {formatDateTime(profile.expiresAt)}
              </Badge>
            )}
          </div>
          {profile.description && <p className="mt-1 text-xs text-muted-foreground">{profile.description}</p>}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onAction('install')}
            disabled={!usable}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 text-xs text-foreground hover:bg-surface-3 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            Installer
          </button>
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
              <DropdownMenuItem onSelect={() => onAction('edit')} className="gap-2">
                <Pencil className="h-3.5 w-3.5" />
                Modifier le profil
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAction('toggle')} className="gap-2">
                <Power className="h-3.5 w-3.5" />
                {profile.enabled ? 'Désactiver' : 'Réactiver'}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAction('rotate')} className="gap-2">
                <RotateCcw className="h-3.5 w-3.5" />
                Régénérer les clés
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onAction('delete')} className="gap-2 text-[hsl(var(--danger))]">
                <Trash2 className="h-3.5 w-3.5" />
                Supprimer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="space-y-3 px-4 py-4 lg:px-5">
        <RouteDiagram
          entry={profile.entryNode}
          exit={profile.exitNode}
          deviceDetail={endpointIp(endpoint) ?? profile.clientIp}
          active={connected && usable}
        />

        {profile.mode === 'full' && usable && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ExitSwitcher profile={profile} gateways={gateways} switchingTo={switchingTo} onSwitch={onSwitchExit} />
            {flash && (
              <span className="inline-flex animate-fade-in items-center gap-1.5 text-xs text-[hsl(var(--ok))]">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {flash}
              </span>
            )}
          </div>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border bg-surface-2/40 px-4 py-2.5 sm:grid-cols-3 lg:grid-cols-5 lg:px-5">
        <Metric label="Adresse VPN">
          <span className="font-mono">{profile.clientIp}</span>
        </Metric>
        <Metric label="Dernière activité" title={formatDateTime(lastHandshakeAt)}>
          <span className="inline-flex items-center gap-1.5">
            {connected && <StatusDot tone="ok" pulse />}
            {lastHandshakeAt ? formatRelative(lastHandshakeAt) : 'Jamais connecté'}
          </span>
        </Metric>
        <Metric label="Débit actuel">
          {live && connected ? (
            <span className="inline-flex items-center gap-2 tabular-nums">
              <span className="inline-flex items-center gap-0.5">
                <ArrowDown className="h-3 w-3 text-muted-foreground" />
                {formatThroughput(live.txRate)}
              </span>
              <span className="inline-flex items-center gap-0.5">
                <ArrowUp className="h-3 w-3 text-muted-foreground" />
                {formatThroughput(live.rxRate)}
              </span>
            </span>
          ) : (
            '—'
          )}
        </Metric>
        {/* rx/tx are counted from the node's side: what it received is what
            the device uploaded, and the other way round. */}
        <Metric label="Volume (session)">
          <span className="tabular-nums">
            ↓ {formatBytes(live?.txBytes ?? profile.session.txBytes)} · ↑ {formatBytes(live?.rxBytes ?? profile.session.rxBytes)}
          </span>
        </Metric>
        <Metric label="Sortie changée">{profile.exitSwitchedAt ? formatRelative(profile.exitSwitchedAt) : '—'}</Metric>
      </dl>
    </Card>
  );
}
