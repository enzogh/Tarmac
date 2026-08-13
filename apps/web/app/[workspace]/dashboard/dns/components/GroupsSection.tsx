'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ChevronDown, Copy, Crown, Server, ScrollText, Trash2, Waves } from 'lucide-react';
import { api, DnsServerGroupItem, NodeItem, VlanConnectionHistory } from '@/lib/api';
import { SectionLabel } from '@/components/SectionLabel';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CardListSkeleton } from '@/components/ui/skeleton';
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
  // Only the node that actively runs the WireGuard latency/loss probe gets
  // latencyMs/packetLoss written for its direction - the mirrored reverse
  // direction only ever gets `status` + rx bandwidth, latency stays null
  // forever for that direction even though the link is genuinely healthy
  // (see agents.service.ts's link-metric ingestion). A fixed
  // source->target query can land on the unmeasured direction and render a
  // silently blank chart under a correct-looking uptime % - fetch both
  // directions and show whichever one actually has data.
  const [forward, setForward] = useState<VlanConnectionHistory | null>(null);
  const [reverse, setReverse] = useState<VlanConnectionHistory | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.vlan.getHistory(vlanId, sourceNodeId, targetNodeId, '1h').catch(() => null),
      api.vlan.getHistory(vlanId, targetNodeId, sourceNodeId, '1h').catch(() => null),
    ]).then(([f, r]) => {
      if (!cancelled) {
        setForward(f);
        setReverse(r);
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [vlanId, sourceNodeId, targetNodeId]);

  if (loading) {
    return <p className="text-xs text-muted-foreground">Chargement de la liaison…</p>;
  }

  const hasMeasuredLatency = (h: VlanConnectionHistory | null) => (h?.samples ?? []).some((s) => s.latencyMs != null);
  const useReverse = !hasMeasuredLatency(forward) && hasMeasuredLatency(reverse);
  const chosen = useReverse ? reverse : forward;
  const chosenLabel = useReverse ? `${targetLabel} → ${sourceLabel}` : `${sourceLabel} → ${targetLabel}`;

  const chartData = (chosen?.samples ?? []).map((sample) => ({
    label: new Date(sample.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
    latencyMs: sample.latencyMs ?? null,
    packetLoss: sample.packetLoss ?? null,
  }));
  const noMeasurementsYet = !!chosen && chosen.samples.length > 0 && !hasMeasuredLatency(chosen);

  return (
    <div className="space-y-1 rounded-xl border border-white/[0.06] bg-black/10 p-3">
      <p className="font-mono text-xs text-zinc-400">
        {chosenLabel}
        {chosen ? ` · ${chosen.uptimePercent}% uptime (1h)` : ''}
      </p>
      {noMeasurementsYet ? (
        <p className="text-xs text-muted-foreground">Lien actif, pas encore de mesure de latence (sondage à venir).</p>
      ) : (
        <ConnectionHistoryChart data={chartData} />
      )}
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
      await api.dns.groups.delete(group.id);
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
      await api.dns.groups.removeMember(groupId, nodeId);
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
        <Card className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
          <CardContent className="pt-12 pb-12 text-center">
            <Server className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
            <p className="font-medium text-muted-foreground">Aucun groupe DNS créé</p>
            <p className="mt-2 text-sm text-muted-foreground">Cliquez sur « Nouveau groupe DNS » pour désigner vos serveurs.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 animate-fade-in">
          {groups.map((group) => {
            const collapsed = cards.isCollapsed(group.id);
            return (
              <Card key={group.id} className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => cards.toggle(group.id)}
                      className="flex items-center gap-2 text-left"
                    >
                      <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${collapsed ? '-rotate-90' : ''}`} />
                      <CardTitle className="flex items-center gap-2">
                        <Server className="w-5 h-5 text-violet-400" />
                        {group.name}
                      </CardTitle>
                    </button>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusIndicator status={group.status} />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
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
                          <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm">
                            <span className="flex items-center gap-2">
                              {member.role === 'primary' ? (
                                <Crown className="h-3.5 w-3.5 text-amber-400" />
                              ) : (
                                <Copy className="h-3.5 w-3.5 text-sky-400" />
                              )}
                              {nodeName(member.nodeId)}
                              <span className="text-xs text-muted-foreground">({member.role})</span>
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
                                  <Button
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
                                  <Button
                                    size="sm"
                                    disabled={busyKey === `conflict-${group.id}-${member.nodeId}`}
                                    onClick={() => resolvePortConflict(group.id, member.nodeId)}
                                  >
                                    Tuer le process et réessayer
                                  </Button>
                                  <Button
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
                                <Button
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
                    {vlanId && group.members.length >= 2 && (
                      <div className="space-y-2 pt-1">
                        <div className="flex items-center gap-1.5">
                          <Waves className="h-3.5 w-3.5 text-violet-400" />
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
