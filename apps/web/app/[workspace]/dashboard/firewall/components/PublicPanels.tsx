'use client';

import { useEffect, useMemo, useState } from 'react';
import { Container, LoaderCircle, Plug, ShieldAlert, TriangleAlert } from 'lucide-react';
import { Callout } from '@/components/Callout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusPill } from '@/components/ui/status';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { api, FirewallListen, FirewallMode, FirewallNode } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { APPLY_INFO, EXPOSURE_INFO, NodeName } from './fw-ui';
import { ModeSelector } from './MeshPanels';

// Ports that should almost never face the internet: kept closed by default
// when filtering is switched on.
const SENSITIVE = new Set([2375, 2376, 3306, 5432, 5984, 6379, 9200, 9300, 11211, 27017, 27018, 5672, 15672, 8086, 9000, 10250]);

function portTitle(listen: FirewallListen) {
  const who = listen.service ?? listen.processes[0] ?? null;
  return `${listen.port}/${listen.protocol}${who ? ` · ${who}` : ''}`;
}

export function ExposureChip({ listen, enforced }: { listen: FirewallListen; enforced?: boolean }) {
  const exposure = enforced ? listen.exposureIfEnforced : listen.exposure;
  const info = EXPOSURE_INFO[exposure];
  const tone = listen.managedBy && exposure === 'public' ? 'neutral' : info.tone;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <StatusPill tone={tone} className="font-mono">
            {listen.port}
            <span className="font-sans opacity-80">{listen.service ?? listen.processes[0] ?? listen.protocol}</span>
          </StatusPill>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p className="font-medium">
          {portTitle(listen)} : {info.label}
        </p>
        <p className="text-muted-foreground">{info.hint}</p>
        {listen.managedBy && <p className="mt-1 text-muted-foreground">Gardé ouvert par Tarmac : {listen.managedBy.toLowerCase()}.</p>}
        {listen.processes.length > 0 && <p className="mt-1 text-muted-foreground">Programme : {listen.processes.join(', ')}</p>}
        {listen.processes.includes('docker-proxy') && <p className="mt-1 text-muted-foreground">Port publié par un conteneur Docker.</p>}
      </TooltipContent>
    </Tooltip>
  );
}

export function PublicNodeCard({
  node,
  busy,
  onChangeMode,
}: {
  node: FirewallNode;
  busy: boolean;
  onChangeMode: (node: FirewallNode, mode: FirewallMode) => void;
}) {
  const apply = APPLY_INFO[node.apply.status];
  const listening = node.report?.listening ?? [];
  const exposed = listening.filter((entry) => entry.exposure !== 'local');
  const wideOpen = exposed.filter((entry) => entry.exposure === 'public' && !entry.managedBy);
  const risky = wideOpen.filter((entry) => SENSITIVE.has(entry.port));
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <NodeName node={node} showIp={false} />
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill tone={apply.tone}>{apply.label}</StatusPill>
            {node.blocked24h > 0 && (
              <StatusPill tone="danger" dot={false}>
                {node.blocked24h.toLocaleString('fr-FR')} bloquée(s) en 24 h
              </StatusPill>
            )}
            {node.report?.docker && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <StatusPill tone="neutral" dot={false}>
                      <Container className="h-3 w-3" />
                      Docker
                    </StatusPill>
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">Les ports publiés par vos conteneurs sont filtrés eux aussi.</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
        <div className="w-full sm:w-[19rem]">
          <ModeSelector value={node.publicMode} onChange={(mode) => onChangeMode(node, mode)} scope="public" busy={busy} compact />
        </div>
      </div>

      {node.apply.message && (node.apply.status === 'error' || node.apply.status === 'outdated' || node.apply.status === 'offline') && (
        <Callout variant={node.apply.status === 'error' ? 'danger' : 'warning'} className="p-2.5 [&_div]:text-xs">
          {node.apply.message}
        </Callout>
      )}

      {!node.report ? (
        node.apply.status === 'offline' ? null : <p className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
          <Plug className="h-3.5 w-3.5 shrink-0" />
          {node.status === 'offline'
            ? 'Serveur hors ligne : ses ports en écoute s’afficheront à son retour.'
            : 'En attente du premier rapport de l’agent (environ 20 secondes). S’il n’arrive pas, mettez l’agent à jour depuis la page Nœuds.'}
        </p>
      ) : exposed.length === 0 ? (
        <p className="text-xs text-muted-foreground">Aucun port n’écoute sur une adresse publique.</p>
      ) : (
        <div className="space-y-1.5">
          <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">
            Ports en écoute{' '}
            <span className="normal-case tracking-normal text-muted-foreground/70">
              · mis à jour {formatRelative(node.report.reportedAt)}
              {node.report.uplinks.length > 0 && ` · interface ${node.report.uplinks.join(', ')}`}
            </span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {exposed.map((entry) => (
              <ExposureChip key={`${entry.protocol}-${entry.port}`} listen={entry} />
            ))}
          </div>
        </div>
      )}

      {risky.length > 0 && (
        <p className="flex items-start gap-2 text-xs text-[hsl(var(--warn))]">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {risky.map((entry) => entry.service ?? entry.port).join(', ')} {risky.length > 1 ? 'sont joignables' : 'est joignable'} par tout Internet.
          Une base de données ou un service d’administration ne devrait l’être que depuis des adresses précises.
        </p>
      )}
    </Card>
  );
}

/**
 * Shown before a node switches to observe/enforce from the internet: which
 * of the ports it serves today would close, with the choice to keep them.
 */
export function EnforcePreflight({
  target,
  onOpenChange,
  onDone,
}: {
  target: { node: FirewallNode; mode: FirewallMode } | null;
  onOpenChange: (open: boolean) => void;
  onDone: (message: string) => void;
}) {
  const closing = useMemo(
    () =>
      (target?.node.report?.listening ?? []).filter(
        (entry) => (entry.exposure === 'public' || entry.exposure === 'restricted') && entry.exposureIfEnforced === 'closed',
      ),
    [target],
  );
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyOf = (entry: FirewallListen) => `${entry.protocol}/${entry.port}`;

  useEffect(() => {
    if (!target) return;
    setKeep(new Set(closing.filter((entry) => !SENSITIVE.has(entry.port)).map(keyOf)));
    setError(null);
  }, [target, closing]);

  if (!target) return null;
  const { node, mode } = target;
  const enforce = mode === 'enforce';

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const kept = closing.filter((entry) => keep.has(keyOf(entry)));
      for (const protocol of ['tcp', 'udp'] as const) {
        const ports = kept.filter((entry) => entry.protocol === protocol).map((entry) => String(entry.port));
        if (ports.length === 0) continue;
        await api.firewall.createRule({
          scope: 'public',
          action: 'allow',
          name: `Services publics de ${node.name}${protocol === 'udp' ? ' (UDP)' : ''}`.slice(0, 80),
          description: 'Créée à l’activation du filtrage Internet, pour garder ouverts les services déjà en ligne.',
          sourceKind: 'any',
          sourceNodeIds: [],
          sourceLabels: [],
          sourceCidrs: [],
          targetKind: 'nodes',
          targetNodeIds: [node.id],
          targetLabels: [],
          protocol,
          ports,
        });
      }
      await api.firewall.setNodesMode([node.id], mode);
      onDone(
        enforce
          ? `Filtrage Internet appliqué sur ${node.name}.${kept.length > 0 ? ` ${kept.length} port(s) gardé(s) ouvert(s).` : ''}`
          : `${node.name} est en observation : les connexions qui seraient bloquées apparaissent dans l’onglet Activité.`,
      );
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Le changement a échoué.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{enforce ? `Filtrer Internet sur ${node.name}` : `Observer le trafic Internet de ${node.name}`}</DialogTitle>
          <DialogDescription>
            {enforce
              ? 'Seuls les ports autorisés resteront joignables depuis Internet. Les connexions déjà ouvertes ne sont pas coupées.'
              : 'Rien ne sera coupé : les connexions qui seraient bloquées en mode appliqué seront journalisées.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!node.report && (
            <Callout variant="warning">
              Tarmac ne connaît pas encore les ports de ce serveur. Mieux vaut passer d’abord en observation, ou attendre le premier rapport de
              l’agent.
            </Callout>
          )}
          {closing.length > 0 ? (
            <>
              <p className="text-sm text-foreground">
                {closing.length} port(s) en ligne aujourd’hui {enforce ? 'seront fermés' : 'seraient fermés en mode appliqué'}. Cochez ceux à garder
                ouverts à tout Internet :
              </p>
              <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                {closing.map((entry) => {
                  const key = keyOf(entry);
                  return (
                    <li key={key}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-2">
                        <Checkbox
                          checked={keep.has(key)}
                          onChange={() =>
                            setKeep((current) => {
                              const next = new Set(current);
                              if (next.has(key)) next.delete(key);
                              else next.add(key);
                              return next;
                            })
                          }
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block font-mono text-sm text-foreground">
                            {entry.port}/{entry.protocol}
                            {entry.service && <span className="ml-2 font-sans text-muted-foreground">{entry.service}</span>}
                          </span>
                          {entry.processes.length > 0 && <span className="block truncate text-2xs text-muted-foreground">{entry.processes.join(', ')}</span>}
                        </span>
                        {SENSITIVE.has(entry.port) && (
                          <span className="inline-flex items-center gap-1 text-2xs text-[hsl(var(--warn))]">
                            <TriangleAlert className="h-3 w-3" />À protéger
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
              <p className="text-2xs text-muted-foreground">
                Les ports gardés ouverts deviennent une règle « Autoriser » que vous pourrez restreindre ensuite à des adresses précises.
              </p>
            </>
          ) : (
            node.report && <p className="text-sm text-muted-foreground">Aucun port actuellement ouvert ne sera fermé.</p>
          )}
          <p className={cn('text-xs text-muted-foreground')}>
            Toujours ouverts : l’accès SSH (protection anti-verrouillage, si activée), le réseau privé Tarmac et, le cas échéant, la passerelle VPN et
            le DNS.
          </p>
          {error && <Callout variant="danger">{error}</Callout>}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Annuler
          </Button>
          <Button write onClick={() => void confirm()} disabled={busy} className="gap-1.5">
            {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {enforce ? 'Appliquer le filtrage' : 'Passer en observation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
