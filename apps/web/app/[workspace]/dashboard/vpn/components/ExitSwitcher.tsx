'use client';

import { useEffect, useState } from 'react';
import { ArrowRightLeft, Check, ChevronDown, LoaderCircle, Undo2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { VpnGateway, VpnProfile } from '@/lib/api';
import { cn } from '@/lib/utils';
import { NodePicker } from './NodePicker';
import { NodeFlag, nodeLocation } from './vpn-ui';

// Up to this many possible exits, one chip each is the fastest switch. Past
// it a chip row stops being scannable, so the card shows the current exit
// and a searchable picker instead.
const MAX_INLINE_CHIPS = 4;

function exitDisabledReason(profile: VpnProfile, gateway: VpnGateway): string | null {
  if (gateway.status === 'offline') return 'Hors ligne : le trafic serait coupé.';
  if (gateway.id !== profile.entryNode.id && gateway.exitEligibility) return gateway.exitEligibility;
  return null;
}

/**
 * The exit switch: re-routes the client's internet traffic through another
 * node immediately, without the client having to reconnect.
 */
export function ExitSwitcher({
  profile,
  gateways,
  switchingTo,
  onSwitch,
}: {
  profile: VpnProfile;
  gateways: VpnGateway[];
  /** Node id a switch is in flight to ('' = direct), null when idle. */
  switchingTo: string | null;
  onSwitch: (exitNodeId: string | null) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const entryId = profile.entryNode.id;
  const currentId = profile.exitNode?.id ?? entryId;
  const busy = switchingTo !== null;
  const pendingId = busy ? switchingTo || entryId : null;
  const candidates = gateways.filter((gateway) => gateway.id === entryId || gateway.exitEligibility === null);

  // Close the picker once the switch it started has landed.
  useEffect(() => {
    if (!busy) setPickerOpen(false);
  }, [busy]);

  const choose = (gateway: VpnGateway) => {
    if (busy || exitDisabledReason(profile, gateway) || gateway.id === currentId) return;
    onSwitch(gateway.id === entryId ? null : gateway.id);
  };

  if (candidates.length <= MAX_INLINE_CHIPS) {
    const sorted = [...candidates].sort((left, right) => {
      if ((left.id === entryId) !== (right.id === entryId)) return left.id === entryId ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Sortir par</span>
        {sorted.map((gateway) => {
          const active = gateway.id === currentId;
          const pending = pendingId === gateway.id;
          const reason = exitDisabledReason(profile, gateway);
          const button = (
            <button
              key={gateway.id}
              type="button"
              onClick={() => choose(gateway)}
              disabled={Boolean(reason) || (busy && !pending)}
              aria-pressed={active}
              className={cn(
                'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors',
                active
                  ? 'border-primary/50 bg-primary/10 font-medium text-foreground'
                  : 'border-border bg-surface-2 text-muted-foreground hover:border-primary/30 hover:text-foreground',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              {pending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <NodeFlag node={gateway} className="text-sm" />}
              <span className="max-w-[10rem] truncate">{gateway.name}</span>
              {gateway.id === entryId && <span className="text-2xs text-muted-foreground">(direct)</span>}
              {active && !pending && <Check className="h-3.5 w-3.5 text-primary" />}
            </button>
          );
          if (!reason) return button;
          return (
            <Tooltip key={gateway.id}>
              <TooltipTrigger asChild>
                <span>{button}</span>
              </TooltipTrigger>
              <TooltipContent>{reason}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    );
  }

  const current = gateways.find((gateway) => gateway.id === currentId) ?? profile.exitNode ?? profile.entryNode;
  const location = nodeLocation(current);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Sortie Internet</span>
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        disabled={busy}
        className="group inline-flex h-9 min-w-0 max-w-full items-center gap-2 rounded-md border border-border bg-surface-2 pl-2.5 pr-2 text-left text-xs transition-colors hover:border-primary/40 disabled:opacity-60"
      >
        {busy ? <LoaderCircle className="h-4 w-4 animate-spin text-primary" /> : <NodeFlag node={current} />}
        <span className="min-w-0">
          <span className="block truncate font-medium text-foreground">
            {current.name}
            {currentId === entryId && <span className="ml-1 font-normal text-muted-foreground">(direct)</span>}
          </span>
          <span className="block truncate font-mono text-2xs text-muted-foreground">
            {current.publicIp ?? 'IP inconnue'}
            {location && <span className="font-sans"> · {location}</span>}
          </span>
        </span>
        <span className="ml-1 inline-flex items-center gap-1 border-l border-border pl-2 text-primary">
          <ArrowRightLeft className="h-3.5 w-3.5" />
          Changer
          <ChevronDown className="h-3.5 w-3.5" />
        </span>
      </button>
      {currentId !== entryId && (
        <button
          type="button"
          onClick={() => onSwitch(null)}
          disabled={busy || profile.entryNode.status === 'offline'}
          className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-2xs text-muted-foreground hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
          title={`Sortir directement par ${profile.entryNode.name}`}
        >
          <Undo2 className="h-3.5 w-3.5" />
          Sortie directe
        </button>
      )}

      <Dialog open={pickerOpen} onOpenChange={(open) => !busy && setPickerOpen(open)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Changer la sortie de « {profile.name} »</DialogTitle>
            <DialogDescription>
              Le trafic Internet de l&apos;appareil bascule immédiatement sur le serveur choisi, sans reconnexion.
            </DialogDescription>
          </DialogHeader>
          <NodePicker
            gateways={candidates}
            value={currentId}
            autoFocus
            busyId={pendingId}
            pinned={[{ gateway: candidates.find((gateway) => gateway.id === entryId) ?? (profile.entryNode as VpnGateway), badge: 'Sortie directe' }]}
            disabledReason={(gateway) => exitDisabledReason(profile, gateway)}
            meta={(gateway) => (gateway.exitProfiles > 0 ? `${gateway.exitProfiles} profil${gateway.exitProfiles > 1 ? 's' : ''}` : null)}
            onSelect={(gateway) => (gateway.id === currentId ? setPickerOpen(false) : choose(gateway))}
            listClassName="max-h-[min(24rem,55vh)]"
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
