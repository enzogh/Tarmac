'use client';

import { Globe, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusDot } from '@/components/ui/status';
import type { NodeActivityItem } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { InternalDnsState } from './node-ui';

/**
 * Fleet-wide answer to "is internal DNS (*.tarmac.local) running, and
 * where?" - previously only readable from the colour of one icon among
 * eight on one node card.
 */
export function InternalDnsCard({
  state,
  nodes,
  onOpenNode,
}: {
  state: InternalDnsState | undefined;
  nodes: NodeActivityItem[];
  onOpenNode: (node: NodeActivityItem) => void;
}) {
  if (!state) return null;
  const node = nodes.find((item) => item.id === state.internalDnsNodeId) ?? null;
  const conflicts = nodes.filter((item) => item.internalDnsForwarderStatus === 'conflict').length;

  let tone: 'ok' | 'warn' | 'danger' | 'neutral' = 'neutral';
  let title = 'DNS interne non configuré';
  let detail = 'Ouvrez un nœud et choisissez « Désigner comme DNS interne » pour que la flotte se joigne par nom (nœud.tarmac.local).';
  if (state.internalDnsNodeId && !node) {
    tone = 'danger';
    title = 'Le nœud DNS interne a disparu';
    detail = 'Le nœud désigné n’existe plus. Désignez-en un autre.';
  } else if (node) {
    if (node.status === 'offline') {
      tone = 'danger';
      title = `DNS interne hors ligne — ${node.name}`;
      detail = 'Le nœud qui sert tarmac.local ne répond plus : la résolution des noms internes est interrompue.';
    } else if (state.internalDnsStatus === 'active') {
      tone = 'ok';
      title = `DNS interne actif sur ${node.name}`;
      detail = `${state.records.length} nom${state.records.length > 1 ? 's' : ''} publié${state.records.length > 1 ? 's' : ''} sous tarmac.local${node.vlanIp ? `, servi par ${node.vlanIp}` : ''}.`;
    } else if (state.internalDnsStatus === 'error') {
      tone = 'danger';
      title = `Échec de l’installation du DNS interne sur ${node.name}`;
      detail = 'Consultez le Journal (agent de ce nœud) pour le détail, puis retirez et redésignez le nœud.';
    } else {
      tone = 'warn';
      title = `Installation du DNS interne sur ${node.name}…`;
      detail = 'En attente de la confirmation de l’agent (quelques secondes, ou à son retour en ligne).';
    }
  }

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3',
        tone === 'ok' && 'border-[hsl(var(--ok))]/25 bg-[hsl(var(--ok))]/[0.06]',
        tone === 'warn' && 'border-[hsl(var(--warn))]/25 bg-[hsl(var(--warn))]/[0.06]',
        tone === 'danger' && 'border-[hsl(var(--danger))]/25 bg-[hsl(var(--danger))]/[0.06]',
        tone === 'neutral' && 'border-border bg-surface-1',
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2">
        {tone === 'warn' ? <LoaderCircle className="h-4 w-4 animate-spin text-[hsl(var(--warn))]" /> : <Globe className="h-4 w-4 text-primary" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <StatusDot tone={tone} pulse={tone === 'ok'} />
          {title}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {detail}
          {conflicts > 0 && ` ${conflicts} nœud(s) signalent un conflit de port pour le résolveur local.`}
        </p>
      </div>
      {node && (
        <Button variant="secondary" size="sm" onClick={() => onOpenNode(node)}>
          Voir le nœud
        </Button>
      )}
    </div>
  );
}
