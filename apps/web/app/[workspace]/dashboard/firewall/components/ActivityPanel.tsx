'use client';

import { useMemo, useState } from 'react';
import { Ban, Container, Eye, Radio, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ListSkeleton } from '@/components/ui/skeleton';
import { StatusPill } from '@/components/ui/status';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, FirewallEvent, FirewallNode, FirewallRule, FirewallScope } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { usePolling } from '@/lib/hooks/usePolling';
import { useLiveSocket } from '@/lib/hooks/useLiveSocket';
import { cn } from '@/lib/utils';
import type { RuleDraft } from './RuleDialog';

const ANY = '__any__';

export function ActivityPanel({
  nodes,
  rules,
  onCreateRule,
}: {
  nodes: FirewallNode[];
  rules: FirewallRule[];
  onCreateRule: (draft: RuleDraft) => void;
}) {
  const [scope, setScope] = useState<'all' | FirewallScope>('all');
  const [verdict, setVerdict] = useState<'all' | 'blocked' | 'observed'>('all');
  const [hours, setHours] = useState('24');
  const [nodeId, setNodeId] = useState(ANY);
  const key = `firewall-events:${scope}:${verdict}:${hours}:${nodeId}`;
  const { data: events, isLoading, mutate } = usePolling(
    key,
    () =>
      api.firewall.events({
        hours: Number(hours),
        scope: scope === 'all' ? undefined : scope,
        verdict: verdict === 'all' ? undefined : verdict,
        nodeId: nodeId === ANY ? undefined : nodeId,
      }),
    { intervalMs: 15000 },
  );
  useLiveSocket((message) => {
    if (message.type === 'firewall.events') void mutate();
  });

  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const ruleById = useMemo(() => new Map(rules.map((rule) => [rule.id, rule])), [rules]);
  const logging = nodes.some((node) => node.report?.logging);
  const withoutLogging = nodes.filter((node) => node.report && !node.report.logging && node.apply.status === 'active');

  const allowDraft = (event: FirewallEvent): RuleDraft => ({
    scope: event.scope,
    action: 'allow',
    sourceKind: event.scope === 'mesh' ? (event.sourceNodeId ? 'nodes' : 'any') : 'cidrs',
    sourceNodeIds: event.sourceNodeId ? [event.sourceNodeId] : [],
    sourceCidrs: event.scope === 'public' ? [event.sourceIp] : [],
    targetKind: 'nodes',
    targetNodeIds: [event.nodeId],
    protocol: event.protocol === 'icmp' ? 'icmp' : event.protocol === 'udp' ? 'udp' : 'tcp',
    ports: event.port && event.protocol !== 'icmp' ? [String(event.port)] : [],
  });
  const blockDraft = (event: FirewallEvent): RuleDraft => ({
    scope: event.scope,
    action: 'deny',
    sourceKind: event.scope === 'mesh' ? (event.sourceNodeId ? 'nodes' : 'any') : 'cidrs',
    sourceNodeIds: event.sourceNodeId ? [event.sourceNodeId] : [],
    sourceCidrs: event.scope === 'public' ? [event.sourceIp] : [],
    targetKind: 'any',
    protocol: 'any',
    ports: [],
    name: event.scope === 'public' ? `Bloquer ${event.sourceIp}` : undefined,
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={scope} onValueChange={(value) => setScope(value as typeof scope)}>
          <TabsList variant="segmented">
            <TabsTrigger value="all">Tout</TabsTrigger>
            <TabsTrigger value="mesh">Entre serveurs</TabsTrigger>
            <TabsTrigger value="public">Depuis Internet</TabsTrigger>
          </TabsList>
        </Tabs>
        <Tabs value={verdict} onValueChange={(value) => setVerdict(value as typeof verdict)}>
          <TabsList variant="segmented">
            <TabsTrigger value="all">Tous</TabsTrigger>
            <TabsTrigger value="blocked">Bloquées</TabsTrigger>
            <TabsTrigger value="observed">Seraient bloquées</TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={hours} onValueChange={setHours}>
          <SelectTrigger className="h-8 w-auto min-w-[8rem] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Dernière heure</SelectItem>
            <SelectItem value="24">24 dernières heures</SelectItem>
            <SelectItem value="168">7 derniers jours</SelectItem>
            <SelectItem value="336">14 derniers jours</SelectItem>
          </SelectContent>
        </Select>
        <Select value={nodeId} onValueChange={setNodeId}>
          <SelectTrigger className="h-8 w-auto min-w-[9rem] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Tous les serveurs</SelectItem>
            {nodes.map((node) => (
              <SelectItem key={node.id} value={node.id}>
                {node.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto inline-flex items-center gap-1.5 text-2xs text-muted-foreground">
          <Radio className="h-3 w-3 text-[hsl(var(--ok))]" />
          En direct
        </span>
      </div>

      {withoutLogging.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Journal indisponible sur {withoutLogging.map((node) => node.name).join(', ')} : le pare-feu y fonctionne, mais le journal du noyau n’est pas
          lisible par l’agent (conteneur ou noyau restreint).
        </p>
      )}

      <Card className="overflow-hidden">
        {isLoading && !events ? (
          <div className="p-4">
            <ListSkeleton rows={4} />
          </div>
        ) : !events || events.length === 0 ? (
          <CardContent className="py-10 text-center">
            <Eye className="mx-auto mb-2 h-5 w-5 text-muted-foreground/60" />
            <p className="text-sm font-medium text-foreground">Aucune connexion bloquée sur cette période</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              {logging
                ? 'Les tentatives bloquées par vos règles, et en mode observation celles qui le seraient, apparaissent ici en direct.'
                : 'Les tentatives bloquées apparaîtront ici dès qu’une règle de blocage ou le mode observation sera actif sur un serveur.'}
            </p>
          </CardContent>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-2xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Quand</th>
                  <th className="px-2 py-2 font-medium">Depuis</th>
                  <th className="px-2 py-2 font-medium">Vers</th>
                  <th className="px-2 py-2 font-medium">Service</th>
                  <th className="px-2 py-2 font-medium">Résultat</th>
                  <th className="px-2 py-2 text-right font-medium">Tentatives</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {events.map((event) => {
                  const target = nodeById.get(event.nodeId);
                  const sourceNode = event.sourceNodeId ? nodeById.get(event.sourceNodeId) : null;
                  const rule = event.ruleId ? ruleById.get(event.ruleId) : null;
                  const others = event.scope === 'public' ? event.sources.filter((ip) => ip !== event.sourceIp).length : 0;
                  return (
                    <tr key={event.id} className="hover:bg-surface-2/50">
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground" title={new Date(event.lastSeenAt).toLocaleString('fr-FR')}>
                        {formatRelative(event.lastSeenAt)}
                      </td>
                      <td className="px-2 py-2.5">
                        {sourceNode ? (
                          <span className="font-medium text-foreground">{sourceNode.name}</span>
                        ) : (
                          <span className="font-mono text-xs text-foreground">{event.sourceIp}</span>
                        )}
                        <span className="block text-2xs text-muted-foreground">
                          {event.scope === 'mesh' ? (sourceNode ? event.sourceIp : 'réseau privé') : others > 0 ? `et ${others} autre(s) adresse(s)` : 'Internet'}
                        </span>
                      </td>
                      <td className="px-2 py-2.5 text-foreground">{target?.name ?? 'serveur supprimé'}</td>
                      <td className="px-2 py-2.5">
                        <span className="font-mono text-xs text-foreground">
                          {event.port ? `${event.port}/${event.protocol}` : event.protocol === 'icmp' ? 'ping' : event.protocol}
                        </span>
                        {event.service && <span className="ml-1.5 text-xs text-muted-foreground">{event.service}</span>}
                        {event.docker && (
                          <span className="ml-1.5 inline-flex items-center gap-0.5 text-2xs text-muted-foreground" title="Port interne d’un conteneur Docker">
                            <Container className="h-3 w-3" />
                            conteneur
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2.5">
                        {event.verdict === 'blocked' ? (
                          <StatusPill tone="danger">Bloquée</StatusPill>
                        ) : (
                          <StatusPill tone="info">Serait bloquée</StatusPill>
                        )}
                        <span className="mt-0.5 block max-w-[12rem] truncate text-2xs text-muted-foreground">
                          {rule ? `par « ${rule.name} »` : event.verdict === 'blocked' ? 'aucune règle ne l’autorise' : 'mode observation'}
                        </span>
                      </td>
                      <td className="px-2 py-2.5 text-right tabular text-foreground">{event.count.toLocaleString('fr-FR')}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right">
                        <div className="inline-flex gap-1">
                          {!rule && (
                            <Button write size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => onCreateRule(allowDraft(event))}>
                              <ShieldCheck className="h-3.5 w-3.5" />
                              Autoriser
                            </Button>
                          )}
                          {(event.verdict === 'observed' || !rule) && (
                            <Button
                              write
                              size="sm"
                              variant="ghost"
                              className={cn('h-7 gap-1 px-2 text-xs text-[hsl(var(--danger))]')}
                              onClick={() => onCreateRule(blockDraft(event))}
                            >
                              <Ban className="h-3.5 w-3.5" />
                              Bloquer la source
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
