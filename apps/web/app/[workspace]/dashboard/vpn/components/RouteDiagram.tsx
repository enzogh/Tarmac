'use client';

import { ReactNode } from 'react';
import { Globe2, Laptop, Network } from 'lucide-react';
import type { VpnNodeRef } from '@/lib/api';
import { cn } from '@/lib/utils';
import { NodeFlag, nodeLocation } from './vpn-ui';

function Hop({
  icon,
  role,
  title,
  detail,
  highlight,
  children,
}: {
  icon: ReactNode;
  role: string;
  title: ReactNode;
  detail?: ReactNode;
  highlight?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 flex-col gap-1 rounded-lg border px-3 py-2',
        highlight ? 'border-primary/40 bg-primary/[0.06]' : 'border-border bg-surface-2',
      )}
    >
      <span className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">{role}</span>
      <span className="flex min-w-0 items-center gap-2 text-sm">
        <span className="shrink-0">{icon}</span>
        <span className="min-w-0 truncate font-medium text-foreground">{title}</span>
      </span>
      {detail && <span className="truncate font-mono text-2xs text-muted-foreground">{detail}</span>}
      {children}
    </div>
  );
}

// The dashes only move while traffic is actually flowing, so the diagram
// itself says whether someone is on the profile right now.
function Connector({ active }: { active: boolean }) {
  return (
    <div className="flex shrink-0 items-center justify-center self-center max-sm:h-3 max-sm:w-full sm:w-6" aria-hidden>
      <span
        className={cn(
          'block max-sm:h-full max-sm:w-px sm:h-px sm:w-full',
          active
            ? 'bg-[length:8px_8px] [background-image:linear-gradient(90deg,hsl(var(--ok))_50%,transparent_0)] max-sm:[background-image:linear-gradient(180deg,hsl(var(--ok))_50%,transparent_0)] motion-safe:max-sm:animate-flow-y motion-safe:sm:animate-flow-x'
            : 'bg-border',
        )}
      />
    </div>
  );
}

function nodeDetail(node: VpnNodeRef) {
  const location = nodeLocation(node);
  return [node.publicIp ?? 'IP inconnue', location].filter(Boolean).join(' · ');
}

/**
 * Appareil -> nœud d'entrée -> nœud de sortie -> Internet (or -> réseau
 * privé). `exitSlot` lets the caller put the exit switcher right where the
 * exit is drawn.
 */
export function RouteDiagram({
  entry,
  exit,
  deviceDetail,
  active = false,
  exitSlot,
  className,
}: {
  entry: VpnNodeRef;
  /** null = private mode: the tunnel ends in the private network. */
  exit: VpnNodeRef | null;
  deviceDetail?: string | null;
  active?: boolean;
  exitSlot?: ReactNode;
  className?: string;
}) {
  const direct = exit !== null && exit.id === entry.id;
  return (
    <div className={cn('flex flex-col items-stretch sm:flex-row', className)}>
      <Hop icon={<Laptop className="h-4 w-4 text-muted-foreground" />} role="Appareil" title="WireGuard" detail={deviceDetail ?? '—'} />
      <Connector active={active} />
      <Hop
        icon={<NodeFlag node={entry} />}
        role={direct ? 'Entrée et sortie' : "Point d'entrée"}
        title={entry.name}
        detail={nodeDetail(entry)}
      >
        {direct && exitSlot}
      </Hop>
      {exit && !direct && (
        <>
          <Connector active={active} />
          <Hop icon={<NodeFlag node={exit} />} role="Sortie Internet" title={exit.name} detail={nodeDetail(exit)} highlight>
            {exitSlot}
          </Hop>
        </>
      )}
      <Connector active={active} />
      {exit ? (
        <Hop
          icon={<Globe2 className="h-4 w-4 text-muted-foreground" />}
          role="IP publique"
          title={exit.publicIp ?? 'inconnue'}
          detail="Vue par les sites visités"
        />
      ) : (
        <Hop
          icon={<Network className="h-4 w-4 text-muted-foreground" />}
          role="Destination"
          title="Réseau privé"
          detail="Vos serveurs uniquement"
        />
      )}
    </div>
  );
}
