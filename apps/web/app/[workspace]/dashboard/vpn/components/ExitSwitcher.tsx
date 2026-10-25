'use client';

import { Check, ChevronDown, LoaderCircle } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { VpnGateway, VpnProfile } from '@/lib/api';
import { cn } from '@/lib/utils';
import { NodeFlag } from './vpn-ui';

// Past this many candidates the chips stop being scannable at a glance; the
// rest move into a "more" menu.
const MAX_INLINE_CHIPS = 5;

type Candidate = { gateway: VpnGateway; direct: boolean; disabledReason: string | null };

function candidatesFor(profile: VpnProfile, gateways: VpnGateway[]): Candidate[] {
  const list = gateways
    .filter((gateway) => gateway.id === profile.entryNode.id || gateway.exitEligibility === null)
    .map((gateway) => ({
      gateway,
      direct: gateway.id === profile.entryNode.id,
      disabledReason:
        gateway.status === 'offline'
          ? 'Hors ligne : le trafic serait coupé.'
          : gateway.id !== profile.entryNode.id && gateway.exitEligibility
            ? gateway.exitEligibility
            : null,
    }));
  // Entry (direct exit) first, then online nodes, then alphabetical.
  return list.sort((left, right) => {
    if (left.direct !== right.direct) return left.direct ? -1 : 1;
    if ((left.disabledReason === null) !== (right.disabledReason === null)) return left.disabledReason === null ? -1 : 1;
    return left.gateway.name.localeCompare(right.gateway.name);
  });
}

/**
 * The one-click exit switch: every node the profile can leave through, as
 * a row of chips. Clicking one re-routes the client's internet traffic
 * through it immediately, without the client having to reconnect.
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
  const candidates = candidatesFor(profile, gateways);
  const currentId = profile.exitNode?.id ?? profile.entryNode.id;
  const busy = switchingTo !== null;
  const inline = candidates.length > MAX_INLINE_CHIPS + 1 ? candidates.slice(0, MAX_INLINE_CHIPS) : candidates;
  const overflow = candidates.slice(inline.length);
  // Keep the active exit visible even when it falls into the overflow.
  const activeInOverflow = overflow.find((candidate) => candidate.gateway.id === currentId);
  const shown = activeInOverflow ? [...inline, activeInOverflow] : inline;
  const hidden = overflow.filter((candidate) => candidate !== activeInOverflow);

  const choose = (candidate: Candidate) => {
    if (busy || candidate.disabledReason || candidate.gateway.id === currentId) return;
    onSwitch(candidate.direct ? null : candidate.gateway.id);
  };

  const chip = (candidate: Candidate) => {
    const active = candidate.gateway.id === currentId;
    const pending = switchingTo !== null && (switchingTo || profile.entryNode.id) === candidate.gateway.id;
    const button = (
      <button
        key={candidate.gateway.id}
        type="button"
        onClick={() => choose(candidate)}
        disabled={Boolean(candidate.disabledReason) || (busy && !pending)}
        aria-pressed={active}
        className={cn(
          'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors',
          active
            ? 'border-primary/50 bg-primary/10 font-medium text-foreground'
            : 'border-border bg-surface-2 text-muted-foreground hover:border-primary/30 hover:text-foreground',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        {pending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <NodeFlag node={candidate.gateway} className="text-sm" />}
        <span className="max-w-[10rem] truncate">{candidate.gateway.name}</span>
        {candidate.direct && <span className="text-2xs text-muted-foreground">(direct)</span>}
        {active && !pending && <Check className="h-3.5 w-3.5 text-primary" />}
      </button>
    );
    if (!candidate.disabledReason) return button;
    return (
      <Tooltip key={candidate.gateway.id}>
        <TooltipTrigger asChild>
          <span>{button}</span>
        </TooltipTrigger>
        <TooltipContent>{candidate.disabledReason}</TooltipContent>
      </Tooltip>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Sortir par</span>
      {shown.map(chip)}
      {hidden.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={busy}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-surface-2 px-2.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {hidden.length} autre{hidden.length > 1 ? 's' : ''}
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
            {hidden.map((candidate) => (
              <DropdownMenuItem
                key={candidate.gateway.id}
                disabled={Boolean(candidate.disabledReason)}
                onSelect={() => choose(candidate)}
                className="gap-2"
              >
                <NodeFlag node={candidate.gateway} className="text-sm" />
                <span className="truncate">{candidate.gateway.name}</span>
                <span className="ml-auto font-mono text-2xs text-muted-foreground">{candidate.gateway.publicIp}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
