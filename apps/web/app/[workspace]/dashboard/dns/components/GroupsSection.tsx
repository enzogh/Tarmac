'use client';

import { AlertTriangle, Copy, Crown, Server, ScrollText, Trash2 } from 'lucide-react';
import { api, DnsServerGroupItem, NodeItem } from '@/lib/api';
import { Callout } from '@/components/Callout';
import { SectionLabel } from '@/components/SectionLabel';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CardListSkeleton } from '@/components/ui/skeleton';
import { JournalLogPanel } from './JournalLogPanel';
import { StatusIndicator } from './StatusIndicator';
import { DnsJournalState, DnsNotice } from './useDnsPageState';

export function GroupsSection({
  groups,
  groupsLoading,
  nodes,
  busyKey,
  setBusyKey,
  setNotice,
  refreshGroups,
  journal,
}: {
  groups: DnsServerGroupItem[];
  groupsLoading: boolean;
  nodes: NodeItem[];
  busyKey: string | null;
  setBusyKey: (key: string | null) => void;
  setNotice: (notice: DnsNotice) => void;
  refreshGroups: () => Promise<unknown>;
  journal: DnsJournalState;
}) {
  const nodeName = (nodeId: string) => nodes.find((n) => n.id === nodeId)?.name ?? nodeId;

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
      <SectionLabel>Groupes de serveurs DNS</SectionLabel>
      <Callout variant="info">
        Le premier nœud choisi devient le serveur DNS <strong>primaire</strong> (maître), les suivants sont
        <strong> secondaires</strong> : le transfert de zone (AXFR/IXFR) se fait entre eux directement, en DNS
        standard — le secondaire continue de répondre même si Tarmac est indisponible.
      </Callout>

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
          {groups.map((group) => (
            <Card key={group.id} className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2">
                    <Server className="w-5 h-5 text-violet-400" />
                    {group.name}
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusIndicator status={group.status} />
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busyKey === `group-${group.id}`}
                      onClick={() => deleteGroup(group)}
                      className="text-rose-300 hover:text-rose-200"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Supprimer
                    </Button>
                  </div>
                </div>
              </CardHeader>
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
                          <StatusIndicator status={member.status} />
                          <Button variant="ghost" size="sm" className="gap-1" onClick={() => journal.toggleLogs(key, member.nodeId)}>
                            <ScrollText className="h-3.5 w-3.5" />
                            {journal.expandedLogKey === key ? 'Masquer' : 'Journal'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busyKey === `member-${group.id}-${member.nodeId}`}
                            onClick={() => removeGroupMember(group.id, member.nodeId)}
                            className="text-rose-300 hover:text-rose-200"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
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
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
