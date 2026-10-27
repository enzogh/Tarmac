'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, ChevronDown, Copy, Crown, Server, ScrollText, Trash2, Waves } from 'lucide-react';
import { api, DnsServerGroupItem, DnsZoneSyncMember, NodeItem, VlanConnectionHistory } from '@/lib/api';
import { SectionLabel } from '@/components/SectionLabel';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CardListSkeleton } from '@/components/ui/skeleton';
import { StatusDot } from '@/components/ui/status';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { HelpText } from '@/components/ui/wizard';
import { ConnectionHistoryChart } from '@/components/dashboard-charts';
import { JournalLogPanel } from './JournalLogPanel';
import { StatusIndicator } from './StatusIndicator';
import { useCollapsibleCards } from './useCollapsibleCards';
import { DnsJournalState, DnsNotice } from './useDnsPageState';

// Reuses the same overlay-mesh latency samples shown on the Network page
// (VlanConnectionSample, via api.vlan.getHistory) for the primary<->secondary
// link of a DNS group - a slow/lossy link directly affects AXFR transfer and
// query-forwarding health, so it's more actionable here than an abstract
// "network quality" number would be on its own.
function GroupLinkLatency({
  vlanId,
  sourceNodeId,
  targetNodeId,
  sourceLabel,
  targetLabel,
}: {
  vlanId: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceLabel: string;
  targetLabel: string;
}) {
  // The API reads both directions of the pair as one series and, for a
  // cross-region pair routed through the gateways, chains the hops.
  const [history, setHistory] = useState<VlanConnectionHistory | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.vlan
      .getHistory(vlanId, sourceNodeId, targetNodeId, '1h')
      .catch(() => null)
      .then((result) => {
        if (!cancelled) setHistory(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [vlanId, sourceNodeId, targetNodeId]);

  if (loading) {
    return <p className="text-xs text-muted-foreground">Chargement de la liaison…</p>;
  }

  const samples = history?.samples ?? [];
  const chartData = samples.map((sample) => ({
    label: new Date(sample.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    latencyMs: sample.latencyMs ?? null,
    packetLoss: sample.packetLoss ?? null,
  }));
  const noMeasurementsYet = samples.length > 0 && !samples.some((sample) => sample.latencyMs != null);
  const via = history?.via ?? [];

  return (
    <div className="space-y-1 rounded-xl border border-border bg-black/10 p-3">
      <p className="font-mono text-xs text-muted-foreground">
        {sourceLabel} → {targetLabel}
        {history?.uptimePercent != null ? ` · ${history.uptimePercent}% uptime (1h)` : ''}
      </p>
      {via.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Routée via {via.length > 1 ? 'les passerelles' : 'la passerelle'} {via.map((gateway) => gateway.name).join(' et ')} : latence cumulée des tronçons.
        </p>
      )}
      {noMeasurementsYet ? (
        <p className="text-xs text-muted-foreground">Lien actif, pas encore de mesure de latence (sondage à venir).</p>
      ) : (
        <ConnectionHistoryChart data={chartData} />
      )}
    </div>
  );
}

const minutesSince = (iso: string) => Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));

/**
 * Whether each secondary actually serves the primary's version of a zone
 * (SOA serial checked every 2 min by the API) - the proof that AXFR/IXFR
 * transfers go through, which the link quality below can't give.
 */
function ZoneSync({ zone, nodeName }: { zone: NonNullable<DnsServerGroupItem['zones']>[number]; nodeName: (nodeId: string) => string }) {
  const detail = zone.syncDetail ?? [];
  const primary = detail.find((entry) => entry.role === 'primary');
  const secondaries = detail.filter((entry) => entry.role === 'secondary');
  if (!zone.syncCheckedAt || secondaries.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        <span className="font-mono">{zone.name}</span> · vérification en attente
      </p>
    );
  }
  const describe = (entry: DnsZoneSyncMember) => {
    if (entry.ok) return { tone: 'ok' as const, text: 'à jour' };
    const lag = entry.behindSince ? ` depuis ${minutesSince(entry.behindSince)} min` : '';
    if (entry.error) return { tone: 'danger' as const, text: `${entry.error}${lag}` };
    return { tone: 'warn' as const, text: `en retard (serial ${entry.serial})${lag}` };
  };
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">
        <span className="font-mono text-foreground/85">{zone.name}</span>
        {primary?.serial != null ? ` · serial ${primary.serial} sur le primaire` : primary?.error ? ` · primaire : ${primary.error}` : ''}
      </p>
      <ul className="space-y-0.5">
        {secondaries.map((entry) => {
          const state = describe(entry);
          return (
            <li key={entry.nodeId} className="flex items-center gap-2 text-xs">
              <StatusDot tone={state.tone} />
              <span className="truncate text-foreground/85">{nodeName(entry.nodeId)}</span>
              <span className={state.tone === 'ok' ? 'text-muted-foreground' : state.tone === 'warn' ? 'text-[hsl(var(--warn))]' : 'text-[hsl(var(--danger))]'}>
                {state.text}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function GroupsSection({
  groups,
  groupsLoading,
  nodes,
  vlanId,
  busyKey,
  setBusyKey,
  setNotice,
  refreshGroups,
  journal,
}: {
  groups: DnsServerGroupItem[];
  groupsLoading: boolean;
  nodes: NodeItem[];
  vlanId: string | null;
  busyKey: string | null;
  setBusyKey: (key: string | null) => void;
  setNotice: (notice: DnsNotice) => void;
  refreshGroups: () => Promise<unknown>;
  journal: DnsJournalState;
}) {
  const nodeName = (nodeId: string) => nodes.find((n) => n.id === nodeId)?.name ?? nodeId;
  const cards = useCollapsibleCards(
    groups,
    (group) => group.status !== 'active' || group.members.some((m) => m.status === 'error'),
  );

  const deleteGroup = async (group: DnsServerGroupItem) => {
    if (!window.confirm(`Supprimer le groupe DNS « ${group.name} » ? Toutes ses zones doivent déjà être supprimées.`)) return;
    setBusyKey(`group-${group.id}`);
    try {
      const { cleanupSent } = await api.dns.groups.delete(group.id);
      setNotice(
        cleanupSent
          ? { type: 'success', message: `Groupe « ${group.name} » supprimé, PowerDNS arrêté sur tous ses serveurs.` }
          : {
              type: 'error',
              message: `Groupe « ${group.name} » supprimé, mais au moins un serveur était hors-ligne — PowerDNS n'a pas pu être arrêté dessus. À faire manuellement s'il redevient actif.`,
            },
      );
      await refreshGroups();
    } catch {
      setNotice({ type: 'error', message: "Erreur lors de la suppression du groupe (contient peut-être encore des zones)." });
    } finally {
      setBusyKey(null);
    }
  };

  const removeGroupMember = async (groupId: string, nodeId: string) => {
    setBusyKey(`member-${groupId}-${nodeId}`);
    try {
      const { cleanupSent } = await api.dns.groups.removeMember(groupId, nodeId);
      setNotice(
        cleanupSent
          ? { type: 'success', message: 'Serveur retiré du groupe, PowerDNS arrêté dessus.' }
          : {
              type: 'error',
              message: "Serveur retiré du groupe — il était hors-ligne, PowerDNS n'a pas pu être arrêté automatiquement dessus. À faire manuellement si ce nœud est toujours actif.",
            },
      );
      await refreshGroups();
    } catch {
      setNotice({ type: 'error', message: 'Erreur lors du retrait du serveur.' });
    } finally {
      setBusyKey(null);
    }
  };

  const resolvePortConflict = async (groupId: string, nodeId: string) => {
    setBusyKey(`conflict-${groupId}-${nodeId}`);
    try {
      await api.dns.groups.resolvePortConflict(groupId, nodeId);
      setNotice({ type: 'success', message: 'Tentative de libération du port envoyée au nœud.' });
      await refreshGroups();
    } catch {
      setNotice({ type: 'error', message: "Erreur lors de l'envoi de la commande." });
    } finally {
      setBusyKey(null);
    }
  };

  // For a member in "Erreur" without a port conflict (e.g. a config bug
  // that's since been fixed agent-side) - re-upserting with the same
  // role/status:'pending' is enough to get the reconciliation loop to
  // resend apply_dns_server_group on its next tick.
  const retryGroupMember = async (groupId: string, member: DnsServerGroupItem['members'][number]) => {
    setBusyKey(`retry-${groupId}-${member.nodeId}`);
    try {
      await api.dns.groups.addMember(groupId, { nodeId: member.nodeId, role: member.role, status: 'pending' });
      setNotice({ type: 'success', message: 'Nouvelle tentative programmée.' });
      await refreshGroups();
    } catch {
      setNotice({ type: 'error', message: 'Erreur lors de la relance.' });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-1.5">
        <SectionLabel>Groupes de serveurs DNS</SectionLabel>
        <HelpText text="Le premier nœud choisi devient le serveur DNS primaire (maître), les suivants sont secondaires : le transfert de zone (AXFR/IXFR) se fait entre eux directement, en DNS standard — le secondaire continue de répondre même si Tarmac est indisponible." />
      </div>

      {groupsLoading ? (
        <CardListSkeleton cards={2} />
      ) : groups.length === 0 ? (
        <Card className="border-border bg-surface-1 backdrop-blur">
          <CardContent className="pt-12 pb-12 text-center">
            <Server className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
            <p className="font-medium text-muted-foreground">Aucun groupe DNS créé</p>
            <p className="mt-2 text-sm text-muted-foreground">Cliquez sur « Nouveau groupe de serveurs » pour désigner les nœuds qui répondront pour vos domaines.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 animate-fade-in">
          {groups.map((group) => {
            const collapsed = cards.isCollapsed(group.id);
            return (
              <Card key={group.id} className="border-border bg-surface-1 backdrop-blur">
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => cards.toggle(group.id)}
                      className="flex items-center gap-2 text-left"
                    >
                      <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${collapsed ? '-rotate-90' : ''}`} />
                      <CardTitle className="flex items-center gap-2">
                        <Server className="w-5 h-5 text-muted-foreground" />
                        {group.name}
                      </CardTitle>
                    </button>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusIndicator status={group.status} />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button write
                            variant="ghost"
                            size="icon"
                            disabled={busyKey === `group-${group.id}`}
                            onClick={() => deleteGroup(group)}
                            className="text-rose-300 hover:text-rose-200"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Supprimer le groupe</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </CardHeader>
                <AnimatePresence initial={false}>
                  {!collapsed && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                  <CardContent className="space-y-2">
                    {group.members.length === 0 && (
                      <p className="text-sm text-muted-foreground">Aucun serveur dans ce groupe.</p>
                    )}
                    {group.members.map((member) => {
                      const key = `member:${group.id}:${member.nodeId}`;
                      return (
                        <div key={member.nodeId} className="space-y-2">
                          <div className="flex items-center justify-between rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm">
                            <span className="flex items-center gap-2">
                              {member.role === 'primary' ? (
                                <Crown className="h-3.5 w-3.5 text-amber-400" />
                              ) : (
                                <Copy className="h-3.5 w-3.5 text-sky-400" />
                              )}
                              {nodeName(member.nodeId)}
                              <span className="text-xs text-muted-foreground">{member.role === 'primary' ? 'primaire' : 'secondaire'}</span>
                            </span>
                            <div className="flex items-center gap-2">
                              <StatusIndicator status={member.status} compact />
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => journal.toggleLogs(key, member.nodeId)}
                                  >
                                    <ScrollText className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>{journal.expandedLogKey === key ? 'Masquer le journal' : 'Afficher le journal'}</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button write
                                    variant="ghost"
                                    size="icon"
                                    disabled={busyKey === `member-${group.id}-${member.nodeId}`}
                                    onClick={() => removeGroupMember(group.id, member.nodeId)}
                                    className="text-rose-300 hover:text-rose-200"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Retirer ce serveur</TooltipContent>
                              </Tooltip>
                            </div>
                          </div>
                          <JournalLogPanel journal={journal} panelKey={key} nodeId={member.nodeId} />
                          {member.conflictDetail && (
                            <Alert variant="destructive" className="ml-1">
                              <AlertTriangle className="h-4 w-4" />
                              <AlertDescription className="space-y-2">
                                <p>
                                  Port {member.conflictDetail.port}/{member.conflictDetail.protocol} déjà utilisé sur{' '}
                                  {nodeName(member.nodeId)} par{' '}
                                  <strong>{member.conflictDetail.processName ?? 'un process inconnu'}</strong>
                                  {member.conflictDetail.pid ? ` (pid ${member.conflictDetail.pid})` : ''} — PowerDNS n'a
                                  pas pu démarrer.
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  <Button write
                                    size="sm"
                                    disabled={busyKey === `conflict-${group.id}-${member.nodeId}`}
                                    onClick={() => resolvePortConflict(group.id, member.nodeId)}
                                  >
                                    Tuer le process et réessayer
                                  </Button>
                                  <Button write
                                    size="sm"
                                    variant="secondary"
                                    disabled={busyKey === `member-${group.id}-${member.nodeId}`}
                                    onClick={() => removeGroupMember(group.id, member.nodeId)}
                                  >
                                    Annuler et changer de serveur
                                  </Button>
                                </div>
                              </AlertDescription>
                            </Alert>
                          )}
                          {member.status === 'error' && !member.conflictDetail && (
                            <Alert variant="destructive" className="ml-1">
                              <AlertTriangle className="h-4 w-4" />
                              <AlertDescription className="space-y-2">
                                <p>
                                  L'application a échoué sur {nodeName(member.nodeId)} — ouvre le Journal
                                  ci-dessus pour voir le message d'erreur de l'agent.
                                </p>
                                <Button write
                                  size="sm"
                                  disabled={busyKey === `retry-${group.id}-${member.nodeId}`}
                                  onClick={() => retryGroupMember(group.id, member)}
                                >
                                  Réessayer
                                </Button>
                              </AlertDescription>
                            </Alert>
                          )}
                        </div>
                      );
                    })}
                    {!!group.zones?.length && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <span className="text-xs text-muted-foreground">Zones :</span>
                        {group.zones.map((zone) => (
                          <Badge key={zone.id} label={zone.name} type={zone.status === 'active' ? 'success' : 'warning'} />
                        ))}
                      </div>
                    )}
                    {group.members.some((m) => m.role === 'secondary') && !!group.zones?.some((zone) => zone.status === 'active') && (
                      <div className="space-y-2 pt-1">
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs font-medium text-zinc-300">Synchronisation des zones</span>
                          <HelpText text="Le serial SOA de chaque zone est comparé toutes les 2 minutes entre le primaire et chaque secondaire. Un secondaire en retard ne reçoit plus les transferts de zone (AXFR/IXFR) : une alerte est levée au-delà de 30 minutes." />
                        </div>
                        <div className="space-y-2 rounded-xl border border-border bg-black/10 p-3">
                          {group.zones
                            .filter((zone) => zone.status === 'active')
                            .map((zone) => (
                              <ZoneSync key={zone.id} zone={zone} nodeName={nodeName} />
                            ))}
                        </div>
                      </div>
                    )}
                    {vlanId && group.members.length >= 2 && (
                      <div className="space-y-2 pt-1">
                        <div className="flex items-center gap-1.5">
                          <Waves className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs font-medium text-zinc-300">Qualité de la liaison AXFR</span>
                          <HelpText text="Latence et perte de paquets mesurées sur le réseau overlay entre le serveur primaire et chaque secondaire - une liaison lente ou instable ralentit ou bloque le transfert de zone (AXFR/IXFR)." />
                        </div>
                        {(() => {
                          const primary = group.members.find((m) => m.role === 'primary');
                          if (!primary) return null;
                          return group.members
                            .filter((m) => m.role !== 'primary')
                            .map((secondary) => (
                              <GroupLinkLatency
                                key={secondary.nodeId}
                                vlanId={vlanId}
                                sourceNodeId={primary.nodeId}
                                targetNodeId={secondary.nodeId}
                                sourceLabel={nodeName(primary.nodeId)}
                                targetLabel={nodeName(secondary.nodeId)}
                              />
                            ));
                        })()}
                      </div>
                    )}
                  </CardContent>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
