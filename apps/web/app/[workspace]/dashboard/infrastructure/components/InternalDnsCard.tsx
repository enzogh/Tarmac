'use client';

import { Globe, LoaderCircle, RotateCcw } from 'lucide-react';
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
  onRetry,
  retrying,
}: {
  state: InternalDnsState | undefined;
  nodes: NodeActivityItem[];
  onOpenNode: (node: NodeActivityItem) => void;
  onRetry: () => void;
  retrying: boolean;
}) {
  if (!state) return null;
  const node = nodes.find((item) => item.id === state.internalDnsNodeId) ?? null;
  const conflicts = nodes.filter((item) => item.internalDnsForwarderStatus === 'conflict').length;
  // Reported by each node's agent from a real query, every ~30 s.
  const unreachable = nodes.filter((item) => item.status !== 'offline' && item.internalDnsForwarderStatus === 'unreachable');
  const reachable = nodes.filter((item) => item.status !== 'offline' && item.internalDnsForwarderStatus === 'active').length;

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
    } else if (state.internalDnsStatus === 'active' && unreachable.length > 0) {
      tone = 'danger';
      title = `DNS interne installé sur ${node.name}, mais injoignable depuis ${unreachable.length} nœud${unreachable.length > 1 ? 's' : ''}`;
      detail = `${unreachable.map((item) => item.name.split('.')[0]).join(', ')} n’obtien${unreachable.length > 1 ? 'nent' : 't'} aucune réponse sur le port 5300 : le pare-feu de ${node.name.split('.')[0]} bloque probablement le réseau privé. Un agent à jour ouvre ce port automatiquement.`;
    } else if (state.internalDnsStatus === 'active') {
      tone = 'ok';
      title = `DNS interne actif sur ${node.name}`;
      detail = `${state.records.length} nom${state.records.length > 1 ? 's' : ''} publié${state.records.length > 1 ? 's' : ''} sous tarmac.local${node.vlanIp ? `, servi par ${node.vlanIp}` : ''}${reachable > 0 ? ` · résolu par ${reachable} nœud${reachable > 1 ? 's' : ''}` : ''}.`;
    } else if (state.internalDnsStatus === 'error') {
      tone = 'danger';
      title = `Échec de l’installation du DNS interne sur ${node.name}`;
      detail = state.internalDnsError
        ? `${state.internalDnsError} — nouvelle tentative automatique toutes les 5 minutes.`
        : 'Le détail est dans le Journal de ce nœud. Nouvelle tentative automatique toutes les 5 minutes.';
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
        <p className="mt-0.5 break-words text-xs text-muted-foreground">
          {detail}
          {conflicts > 0 && ` ${conflicts} nœud(s) signalent un conflit de port pour le résolveur local.`}
        </p>
      </div>
      {node && state.internalDnsStatus === 'error' && node.status !== 'offline' && (
        <Button size="sm" onClick={onRetry} disabled={retrying} className="gap-1.5">
          {retrying ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          Réessayer
        </Button>
      )}
      {node && (
        <Button variant="secondary" size="sm" onClick={() => onOpenNode(node)}>
          Voir le nœud
        </Button>
      )}
    </div>
  );
}
