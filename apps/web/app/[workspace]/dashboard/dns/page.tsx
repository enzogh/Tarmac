'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Crown,
  Globe,
  KeyRound,
  Layers,
  Loader2,
  MapPin,
  Plus,
  ScrollText,
  Server,
  ShieldCheck,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import {
  api,
  AgentLogItem,
  DnsNodeRecordRef,
  DnsPortConflict,
  DnsRecordItem,
  DnsRecordType,
  DnsServerGroupItem,
  DnsZoneItem,
  NodeItem,
} from '../../../../lib/api';
import { usePolling } from '../../../../lib/hooks/usePolling';
import { useLiveSocket } from '../../../../lib/hooks/useLiveSocket';
import { PageHeader } from '../../../../components/PageHeader';
import { Callout } from '../../../../components/Callout';
import { SectionLabel } from '../../../../components/SectionLabel';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Alert, AlertDescription } from '../../../../components/ui/alert';
import { Badge, StatCard } from '../../../../components/ui';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../components/ui/select';
import { CardListSkeleton, StatCardSkeleton } from '../../../../components/ui/skeleton';
import type { WorldMapNode } from '../../../../components/WorldMap';

const WorldMap = dynamic(() => import('../../../../components/WorldMap').then((mod) => mod.WorldMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-[420px] items-center justify-center rounded-xl border border-white/[0.08] bg-zinc-950/50 text-sm text-muted-foreground">
      Chargement de la carte…
    </div>
  ),
});

const STATUS_BADGE: Record<string, { label: string; type: 'success' | 'warning' | 'error' | 'info' }> = {
  active: { label: 'Actif', type: 'success' },
  pending: { label: 'En attente', type: 'warning' },
  error: { label: 'Erreur', type: 'error' },
};

// A bare "En attente" badge reads as stuck, not in-progress - the spinner
// makes it visually obvious the agent is actively working on it (config
// push, package install, service restart...) rather than waiting on the
// user for something.
function StatusIndicator({ status }: { status: 'pending' | 'active' | 'error' }) {
  const badge = STATUS_BADGE[status] ?? STATUS_BADGE.pending;
  return (
    <span className="inline-flex items-center gap-1.5">
      {status === 'pending' && <Loader2 className="h-3 w-3 animate-spin text-amber-400" />}
      <Badge label={badge.label} type={badge.type} />
    </span>
  );
}

const RECORD_TYPES: DnsRecordType[] = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'CAA', 'SRV', 'PTR'];

type RecordValueDraft = { content: string; nodeId: string; priority: string };

const emptyValueDraft = (): RecordValueDraft => ({ content: '', nodeId: '', priority: '' });

export default function DnsPage() {
  const { data: nodes = [] } = usePolling('nodes', api.nodes.list);
  const {
    data: groupsRaw,
    mutate: refreshGroups,
    isLoading: groupsLoading,
  } = usePolling('dns-groups', api.dns.groups.list, { intervalMs: 15000 });
  const {
    data: zonesRaw,
    mutate: refreshZones,
    isLoading: zonesLoading,
  } = usePolling('dns-zones', () => api.dns.zones.list(), { intervalMs: 15000 });
  const groups = groupsRaw ?? [];
  const zones = zonesRaw ?? [];

  const [notice, setNotice] = useState<{ type: 'error' | 'success'; message: string } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Patches a group member's / zone's status the instant the agent's
  // command result lands server-side (see agents.service.ts onCommandResult
  // -> live.broadcast('dns.group_member.status'/'dns.zone.status')), instead
  // of waiting for the next 15s poll tick - same pattern as node.heartbeat
  // on the infrastructure page. Bails until the first real poll has landed
  // (groupsRaw/zonesRaw defined) - patching `undefined` would poison the
  // SWR cache permanently (see infrastructure/page.tsx for the same guard).
  useLiveSocket((message) => {
    if (message.type === 'dns.group_member.status') {
      if (!groupsRaw) return;
      const update = message.payload as {
        groupId: string;
        nodeId: string;
        status: 'pending' | 'active' | 'error';
        conflictDetail: DnsPortConflict | null;
      };
      void refreshGroups(
        (current) =>
          current?.map((group) =>
            group.id === update.groupId
              ? {
                  ...group,
                  members: group.members.map((member) =>
                    member.nodeId === update.nodeId
                      ? { ...member, status: update.status, conflictDetail: update.conflictDetail }
                      : member,
                  ),
                }
              : group,
          ) ?? current,
        { revalidate: false },
      );
      return;
    }

    if (message.type === 'dns.zone.status') {
      if (!zonesRaw) return;
      const update = message.payload as { zoneId: string; status: 'pending' | 'active' | 'error' };
      void refreshZones(
        (current) =>
          current?.map((zone) => (zone.id === update.zoneId ? { ...zone, status: update.status } : zone)) ?? current,
        { revalidate: false },
      );
      return;
    }

    // Live-appends to whichever node's log panel is currently open, so a
    // user watching a "En attente" row can see exactly what the agent is
    // doing (package install, config write, service start...) instead of
    // just staring at a spinner - and if it fails, see why immediately
    // instead of guessing from a bare "Erreur" badge.
    if (message.type === 'agent-log.new') {
      const entry = message.payload as AgentLogItem;
      if (!expandedLogNodeId || entry.nodeId !== expandedLogNodeId) return;
      if (!/dns/i.test(entry.message)) return;
      setLogsByNode((prev) => ({ ...prev, [entry.nodeId]: [entry, ...(prev[entry.nodeId] ?? [])].slice(0, 50) }));
    }
  });

  // Journal panel: shows recent DNS-related agent-log entries for a node,
  // toggled per group-member/zone row (mirrors the SMART-history expand
  // pattern on the infrastructure page). `expandedLogKey` is per-ROW (e.g.
  // "member:<nodeId>" vs "zone:<zoneId>"), kept separate from
  // `expandedLogNodeId` (which node's live log stream is being watched) -
  // a group's primary member and its zone share the same nodeId, so
  // without this split, opening one row's panel also opened the other's.
  const [expandedLogKey, setExpandedLogKey] = useState<string | null>(null);
  const [expandedLogNodeId, setExpandedLogNodeId] = useState<string | null>(null);
  const [logsByNode, setLogsByNode] = useState<Record<string, AgentLogItem[]>>({});
  const [logsLoadingNodeId, setLogsLoadingNodeId] = useState<string | null>(null);

  const toggleLogs = async (key: string, nodeId: string) => {
    if (expandedLogKey === key) {
      setExpandedLogKey(null);
      setExpandedLogNodeId(null);
      return;
    }
    setExpandedLogKey(key);
    setExpandedLogNodeId(nodeId);
    setLogsLoadingNodeId(nodeId);
    try {
      const { items } = await api.agentLogs.list({ nodeId, limit: 30 });
      setLogsByNode((prev) => ({ ...prev, [nodeId]: items.filter((entry) => /dns/i.test(entry.message)) }));
    } catch {
      setLogsByNode((prev) => ({ ...prev, [nodeId]: [] }));
    } finally {
      setLogsLoadingNodeId(null);
    }
  };

  // Group creation dialog
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupNodeIds, setGroupNodeIds] = useState<string[]>([]);

  // Zone creation dialog
  const [zoneDialogOpen, setZoneDialogOpen] = useState(false);
  const [zoneForm, setZoneForm] = useState({ groupId: '', name: '', dnssecEnabled: true });

  // Record editor dialog
  const [recordDialogZoneId, setRecordDialogZoneId] = useState<string | null>(null);
  const [recordForm, setRecordForm] = useState({ name: '@', type: 'A' as DnsRecordType, ttl: 3600, isGeo: false });
  const [recordValues, setRecordValues] = useState<RecordValueDraft[]>([emptyValueDraft()]);

  // Delegation / DNSSEC panel
  const [infoPanel, setInfoPanel] = useState<{
    zone: DnsZoneItem;
    tab: 'delegation' | 'dnssec';
    delegation?: { nsHostnames: string[]; glue: Array<{ host: string; ip: string }> };
    dnssec?: { dsRecords: string[]; dnskeyRecords: string[] };
    loading: boolean;
  } | null>(null);

  // Geo tab: which servers are DNS-relevant (group member or a record's geo
  // target) and, once one is clicked, what points to it - reuses the same
  // reverse-lookup endpoint as the infrastructure page's node detail panel.
  const [geoPanel, setGeoPanel] = useState<{ node: NodeItem; records: DnsNodeRecordRef[] | null; loading: boolean } | null>(
    null,
  );

  const dnsRelevantNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const group of groups) {
      for (const member of group.members) ids.add(member.nodeId);
    }
    for (const zone of zones) {
      for (const record of zone.records) {
        for (const value of record.values) {
          if (value.nodeId) ids.add(value.nodeId);
        }
      }
    }
    return ids;
  }, [groups, zones]);

  const dnsWorldMapNodes: WorldMapNode[] = useMemo(
    () =>
      nodes
        .filter((node) => dnsRelevantNodeIds.has(node.id) && node.locationLat != null && node.locationLng != null)
        .map((node) => ({
          id: node.id,
          label: node.name,
          vlanIp: node.externalIp ?? '',
          status: node.status,
          city: node.locationCity ?? '',
          country: node.locationCountry ?? '',
          countryCode: node.locationCountryCode ?? null,
          lat: node.locationLat as number,
          lng: node.locationLng as number,
          isPositionApproximate: false,
        })),
    [nodes, dnsRelevantNodeIds],
  );

  const openGeoNode = (nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    setGeoPanel({ node, records: null, loading: true });
    api.dns
      .recordsForNode(nodeId)
      .then((records) => setGeoPanel({ node, records, loading: false }))
      .catch(() => setGeoPanel({ node, records: [], loading: false }));
  };

  const nodeName = (nodeId: string) => nodes.find((n) => n.id === nodeId)?.name ?? nodeId;
  const nodeExternalIp = (nodeId: string) => nodes.find((n) => n.id === nodeId)?.externalIp ?? '';

  const renderLogPanel = (key: string, nodeId: string) => {
    if (expandedLogKey !== key) return null;
    const entries = logsByNode[nodeId];
    return (
      <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-white/[0.08] bg-zinc-950/70 p-2.5 font-mono text-xs">
        {logsLoadingNodeId === nodeId ? (
          <p className="text-muted-foreground">Chargement…</p>
        ) : !entries || entries.length === 0 ? (
          <p className="text-muted-foreground">Aucun log DNS pour ce nœud pour l'instant.</p>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="flex gap-2">
              <span className="shrink-0 text-muted-foreground">
                {new Date(entry.createdAt).toLocaleTimeString('fr-FR')}
              </span>
              <span className={entry.level === 'error' || entry.level === 'critical' ? 'text-rose-300' : 'text-zinc-300'}>
                {entry.message}
              </span>
            </div>
          ))
        )}
      </div>
    );
  };

  const resetGroupForm = () => {
    setGroupName('');
    setGroupNodeIds([]);
  };

  const toggleGroupNode = (nodeId: string) => {
    setGroupNodeIds((prev) => (prev.includes(nodeId) ? prev.filter((id) => id !== nodeId) : [...prev, nodeId]));
  };

  const createGroup = async () => {
    if (!groupName.trim()) {
      setNotice({ type: 'error', message: 'Le nom du groupe DNS est obligatoire.' });
      return;
    }
    setBusyKey('create-group');
    try {
      const group = await api.dns.groups.create({ name: groupName.trim() });
      await Promise.all(
        groupNodeIds.map((nodeId, index) =>
          api.dns.groups.addMember(group.id, {
            nodeId,
            role: index === 0 ? 'primary' : 'secondary',
            status: 'pending',
          }),
        ),
      );
      setNotice({ type: 'success', message: `Groupe DNS « ${group.name} » créé.` });
      setGroupDialogOpen(false);
      resetGroupForm();
      await refreshGroups();
    } catch {
      setNotice({ type: 'error', message: 'Erreur lors de la création du groupe DNS.' });
    } finally {
      setBusyKey(null);
    }
  };

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

  const createZone = async () => {
    if (!zoneForm.groupId || !zoneForm.name.trim()) {
      setNotice({ type: 'error', message: 'Groupe DNS et nom de domaine sont obligatoires.' });
      return;
    }
    setBusyKey('create-zone');
    try {
      const zone = await api.dns.zones.create({
        groupId: zoneForm.groupId,
        name: zoneForm.name.trim(),
        dnssecEnabled: zoneForm.dnssecEnabled,
      });
      setNotice({ type: 'success', message: `Zone « ${zone.name} » créée.` });
      setZoneDialogOpen(false);
      setZoneForm({ groupId: '', name: '', dnssecEnabled: true });
      await refreshZones();
    } catch {
      setNotice({ type: 'error', message: 'Erreur lors de la création de la zone (nom déjà utilisé ?).' });
    } finally {
      setBusyKey(null);
    }
  };

  const deleteZone = async (zone: DnsZoneItem) => {
    if (!window.confirm(`Supprimer la zone « ${zone.name} » et tous ses enregistrements ?`)) return;
    setBusyKey(`zone-${zone.id}`);
    try {
      await api.dns.zones.delete(zone.id);
      await refreshZones();
    } catch {
      setNotice({ type: 'error', message: 'Erreur lors de la suppression de la zone.' });
    } finally {
      setBusyKey(null);
    }
  };

  const openRecordDialog = (zoneId: string, existing?: DnsRecordItem) => {
    setRecordDialogZoneId(zoneId);
    if (existing) {
      setRecordForm({ name: existing.name, type: existing.type, ttl: existing.ttl, isGeo: existing.isGeo });
      setRecordValues(
        existing.values.length
          ? existing.values.map((v) => ({
              content: v.content,
              nodeId: v.nodeId ?? '',
              priority: v.priority != null ? String(v.priority) : '',
            }))
          : [emptyValueDraft()],
      );
    } else {
      setRecordForm({ name: '@', type: 'A', ttl: 3600, isGeo: false });
      setRecordValues([emptyValueDraft()]);
    }
  };

  const saveRecord = async () => {
    if (!recordDialogZoneId) return;
    const values = recordValues
      .filter((v) => v.content.trim())
      .map((v) => ({
        content: v.content.trim(),
        ...(v.nodeId ? { nodeId: v.nodeId } : {}),
        ...(v.priority.trim() ? { priority: Number(v.priority) } : {}),
      }));
    if (!recordForm.name.trim() || values.length === 0) {
      setNotice({ type: 'error', message: 'Nom du record et au moins une valeur sont obligatoires.' });
      return;
    }
    setBusyKey('save-record');
    try {
      await api.dns.zones.upsertRecord(recordDialogZoneId, {
        name: recordForm.name.trim(),
        type: recordForm.type,
        ttl: recordForm.ttl,
        isGeo: recordForm.isGeo,
        values,
      });
      setNotice({ type: 'success', message: 'Enregistrement DNS enregistré.' });
      setRecordDialogZoneId(null);
      await refreshZones();
    } catch {
      setNotice({ type: 'error', message: "Erreur lors de l'enregistrement du record." });
    } finally {
      setBusyKey(null);
    }
  };

  const deleteRecord = async (zoneId: string, recordId: string) => {
    setBusyKey(`record-${recordId}`);
    try {
      await api.dns.zones.deleteRecord(zoneId, recordId);
      await refreshZones();
    } catch {
      setNotice({ type: 'error', message: "Erreur lors de la suppression de l'enregistrement." });
    } finally {
      setBusyKey(null);
    }
  };

  const openDelegation = async (zone: DnsZoneItem) => {
    setInfoPanel({ zone, tab: 'delegation', loading: true });
    try {
      const delegation = await api.dns.zones.getDelegation(zone.id);
      setInfoPanel({ zone, tab: 'delegation', delegation, loading: false });
    } catch {
      setInfoPanel(null);
      setNotice({ type: 'error', message: 'Erreur lors de la récupération de la délégation.' });
    }
  };

  const openDnssec = async (zone: DnsZoneItem) => {
    setInfoPanel({ zone, tab: 'dnssec', loading: true });
    try {
      const dnssec = await api.dns.zones.getDnssecKeys(zone.id);
      setInfoPanel({ zone, tab: 'dnssec', dnssec, loading: false });
    } catch {
      setInfoPanel(null);
      setNotice({ type: 'error', message: 'Erreur lors de la récupération des clés DNSSEC (nœud primaire hors-ligne ?).' });
    }
  };

  const activeGroups = groups.filter((g) => g.status === 'active').length;
  const totalRecords = zones.reduce((sum, zone) => sum + zone.records.length, 0);

  return (
    <>
      <div className="space-y-8">
        {notice && (
          <Alert variant={notice.type === 'error' ? 'destructive' : 'success'}>
            {notice.type === 'error' ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            <AlertDescription>{notice.message}</AlertDescription>
          </Alert>
        )}

        <PageHeader
          icon={Globe}
          title="DNS"
          description="Désignez des serveurs DNS primaire/secondaire dans votre flotte, gérez vos zones et le géo-routage."
          actions={
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => setZoneDialogOpen(true)}
                disabled={groups.length === 0}
                className="gap-2"
              >
                <Plus className="w-4 h-4" />
                Nouvelle zone
              </Button>
              <Button onClick={() => setGroupDialogOpen(true)} className="gap-2 bg-violet-600 text-white hover:bg-violet-500">
                <Plus className="w-5 h-5" />
                Nouveau groupe DNS
              </Button>
            </div>
          }
        />

        <section className="space-y-4">
          <SectionLabel>Aperçu</SectionLabel>
          {groupsLoading ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3 animate-fade-in">
              <StatCard label="Groupes DNS" value={groups.length} icon={<Layers className="h-8 w-8" />} changeType="neutral" />
              <StatCard
                label="Groupes actifs"
                value={activeGroups}
                icon={<ShieldCheck className="h-8 w-8" />}
                changeType={activeGroups === groups.length && groups.length > 0 ? 'up' : 'neutral'}
              />
              <StatCard label="Zones / records" value={`${zones.length} / ${totalRecords}`} icon={<Globe className="h-8 w-8" />} changeType="neutral" />
            </div>
          )}
        </section>

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
              {groups.map((group) => {
                return (
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
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="gap-1"
                                  onClick={() => toggleLogs(`member:${group.id}:${member.nodeId}`, member.nodeId)}
                                >
                                  <ScrollText className="h-3.5 w-3.5" />
                                  {expandedLogKey === `member:${group.id}:${member.nodeId}` ? 'Masquer' : 'Journal'}
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
                            {renderLogPanel(`member:${group.id}:${member.nodeId}`, member.nodeId)}
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
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <SectionLabel>Zones</SectionLabel>
          {zonesLoading ? (
            <CardListSkeleton cards={2} />
          ) : zones.length === 0 ? (
            <Card className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
              <CardContent className="pt-12 pb-12 text-center">
                <Globe className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
                <p className="font-medium text-muted-foreground">Aucune zone créée</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {groups.length === 0
                    ? "Crée d'abord un groupe DNS, puis une zone."
                    : 'Cliquez sur « Nouvelle zone » pour ajouter un domaine.'}
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 animate-fade-in">
              {zones.map((zone) => {
                const group = groups.find((g) => g.id === zone.groupId);
                const primaryNodeId = group?.members.find((m) => m.role === 'primary')?.nodeId;
                return (
                  <Card key={zone.id} className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
                    <CardHeader>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardTitle className="flex items-center gap-2">
                          <Globe className="w-5 h-5 text-violet-400" />
                          {zone.name}
                        </CardTitle>
                        <div className="flex flex-wrap items-center gap-2">
                          {group && <Badge label={group.name} type="info" />}
                          {zone.dnssecEnabled && <Badge label="DNSSEC" type="success" />}
                          <StatusIndicator status={zone.status} />
                          {primaryNodeId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1"
                              onClick={() => toggleLogs(`zone:${zone.id}`, primaryNodeId)}
                            >
                              <ScrollText className="h-3.5 w-3.5" />
                              {expandedLogKey === `zone:${zone.id}` ? 'Masquer' : 'Journal'}
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => openDelegation(zone)} className="gap-1">
                            <KeyRound className="h-3.5 w-3.5" />
                            Délégation
                          </Button>
                          {zone.dnssecEnabled && (
                            <Button variant="ghost" size="sm" onClick={() => openDnssec(zone)} className="gap-1">
                              <ShieldCheck className="h-3.5 w-3.5" />
                              DNSSEC
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busyKey === `zone-${zone.id}`}
                            onClick={() => deleteZone(zone)}
                            className="text-rose-300 hover:text-rose-200"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      {primaryNodeId && renderLogPanel(`zone:${zone.id}`, primaryNodeId)}
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {zone.records.length === 0 && (
                        <p className="text-sm text-muted-foreground">Aucun enregistrement pour cette zone.</p>
                      )}
                      {zone.records.map((record) => {
                        return (
                          <div
                            key={record.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-sm"
                          >
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="font-mono">{record.name}</span>
                              <Badge label={record.type} type="info" />
                              {record.isGeo && <Badge label="Géo-routage" type="success" />}
                              <span className="text-xs text-muted-foreground">TTL {record.ttl}s</span>
                              <span className="text-xs text-muted-foreground">
                                {record.values.map((v) => v.content).join(', ')}
                              </span>
                            </span>
                            <div className="flex items-center gap-2">
                              <StatusIndicator status={record.status} />
                              <Button variant="ghost" size="sm" onClick={() => openRecordDialog(zone.id, record)}>
                                Modifier
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={busyKey === `record-${record.id}`}
                                onClick={() => deleteRecord(zone.id, record.id)}
                                className="text-rose-300 hover:text-rose-200"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                      <Button variant="secondary" size="sm" className="gap-1" onClick={() => openRecordDialog(zone.id)}>
                        <Plus className="h-3.5 w-3.5" />
                        Ajouter un enregistrement
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        <section className="space-y-4">
          <SectionLabel>Carte géographique</SectionLabel>
          <Callout variant="info">
            Serveurs DNS et cibles géo-routées de ta flotte. Clique sur un marqueur pour voir quelles zones/records le
            ciblent.
          </Callout>
          {dnsWorldMapNodes.length === 0 ? (
            <Card className="border-white/[0.08] bg-zinc-900/65 backdrop-blur">
              <CardContent className="pt-12 pb-12 text-center">
                <MapPin className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
                <p className="font-medium text-muted-foreground">Aucun nœud géolocalisé impliqué dans le DNS</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Renseigne la localisation de tes nœuds depuis la page Infrastructure pour les voir apparaître ici.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card className="overflow-hidden border-white/[0.08] bg-zinc-900/65 backdrop-blur">
              <WorldMap nodes={dnsWorldMapNodes} onSelectNode={openGeoNode} className="h-[420px] w-full" />
            </Card>
          )}
        </section>
      </div>

      {/* Group creation dialog */}
      <Dialog
        open={groupDialogOpen}
        onOpenChange={(open) => {
          setGroupDialogOpen(open);
          if (!open) resetGroupForm();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouveau groupe DNS</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dns-group-name">Nom du groupe</Label>
              <Input
                id="dns-group-name"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="ex: dns-principal"
              />
            </div>
            <div className="space-y-2">
              <Label>Serveurs</Label>
              <p className="text-xs text-muted-foreground">
                Le premier nœud coché devient le primaire, les suivants sont secondaires.
              </p>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {nodes.map((node) => {
                  const checked = groupNodeIds.includes(node.id);
                  const index = groupNodeIds.indexOf(node.id);
                  return (
                    <label
                      key={node.id}
                      className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 transition ${
                        checked ? 'border-violet-500/50 bg-violet-500/[0.08]' : 'border-white/[0.1] bg-zinc-950/50'
                      }`}
                    >
                      <span className="flex items-center gap-2 text-sm text-foreground">
                        <input type="checkbox" checked={checked} onChange={() => toggleGroupNode(node.id)} className="h-4 w-4 rounded" />
                        {node.name}
                        <span className="text-xs text-muted-foreground">({node.status})</span>
                      </span>
                      {checked && (
                        <Badge label={index === 0 ? 'primaire' : 'secondaire'} type={index === 0 ? 'info' : 'success'} />
                      )}
                    </label>
                  );
                })}
                {nodes.length === 0 && <p className="text-sm text-muted-foreground">Aucun nœud enregistré.</p>}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setGroupDialogOpen(false)}>
              Annuler
            </Button>
            <Button onClick={createGroup} disabled={busyKey === 'create-group'}>
              {busyKey === 'create-group' ? 'Création…' : 'Créer le groupe'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Zone creation dialog */}
      <Dialog open={zoneDialogOpen} onOpenChange={setZoneDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouvelle zone DNS</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dns-zone-group">Groupe DNS</Label>
              <Select value={zoneForm.groupId} onValueChange={(value) => setZoneForm((prev) => ({ ...prev, groupId: value }))}>
                <SelectTrigger id="dns-zone-group">
                  <SelectValue placeholder="Choisir un groupe" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dns-zone-name">Domaine</Label>
              <Input
                id="dns-zone-name"
                value={zoneForm.name}
                onChange={(e) => setZoneForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="exemple.com"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={zoneForm.dnssecEnabled}
                onChange={(e) => setZoneForm((prev) => ({ ...prev, dnssecEnabled: e.target.checked }))}
                className="h-4 w-4 rounded"
              />
              Activer DNSSEC
            </label>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setZoneDialogOpen(false)}>
              Annuler
            </Button>
            <Button onClick={createZone} disabled={busyKey === 'create-zone'}>
              {busyKey === 'create-zone' ? 'Création…' : 'Créer la zone'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record editor dialog */}
      <Dialog open={!!recordDialogZoneId} onOpenChange={(open) => !open && setRecordDialogZoneId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enregistrement DNS</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="record-name">Nom</Label>
                <Input
                  id="record-name"
                  value={recordForm.name}
                  onChange={(e) => setRecordForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="@ (apex) ou www"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="record-type">Type</Label>
                <Select
                  value={recordForm.type}
                  onValueChange={(value) => setRecordForm((prev) => ({ ...prev, type: value as DnsRecordType }))}
                >
                  <SelectTrigger id="record-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RECORD_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="record-ttl">TTL (secondes)</Label>
                <Input
                  id="record-ttl"
                  type="number"
                  min={1}
                  value={recordForm.ttl}
                  onChange={(e) => setRecordForm((prev) => ({ ...prev, ttl: Number(e.target.value) || 3600 }))}
                />
              </div>
              <label className="flex items-end gap-2 pb-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={recordForm.isGeo}
                  onChange={(e) => setRecordForm((prev) => ({ ...prev, isGeo: e.target.checked }))}
                  className="h-4 w-4 rounded"
                />
                Géo-routage (répond selon la localisation du client)
              </label>
            </div>

            <div className="space-y-2">
              <Label>Valeurs {recordForm.isGeo && '(candidats géo-routés)'}</Label>
              {recordValues.map((value, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.08] bg-zinc-950/50 p-2">
                  <Select
                    value={value.nodeId || '__manual__'}
                    onValueChange={(nodeId) => {
                      setRecordValues((prev) =>
                        prev.map((v, i) =>
                          i === index
                            ? nodeId === '__manual__'
                              ? { ...v, nodeId: '' }
                              : { ...v, nodeId, content: nodeExternalIp(nodeId) || v.content }
                            : v,
                        ),
                      );
                    }}
                  >
                    <SelectTrigger className="w-44 shrink-0">
                      <SelectValue placeholder="Nœud (optionnel)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__manual__">Saisie manuelle</SelectItem>
                      {nodes.map((node) => (
                        <SelectItem key={node.id} value={node.id}>
                          {node.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={value.content}
                    onChange={(e) =>
                      setRecordValues((prev) => prev.map((v, i) => (i === index ? { ...v, content: e.target.value } : v)))
                    }
                    placeholder="IP, hostname ou texte selon le type"
                    className="min-w-[10rem] flex-1"
                  />
                  {(recordForm.type === 'MX' || recordForm.type === 'SRV') && (
                    <Input
                      type="number"
                      value={value.priority}
                      onChange={(e) =>
                        setRecordValues((prev) => prev.map((v, i) => (i === index ? { ...v, priority: e.target.value } : v)))
                      }
                      placeholder="priorité"
                      className="w-24"
                    />
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRecordValues((prev) => prev.filter((_, i) => i !== index))}
                    disabled={recordValues.length === 1}
                    className="text-rose-300 hover:text-rose-200"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <Button variant="secondary" size="sm" className="gap-1" onClick={() => setRecordValues((prev) => [...prev, emptyValueDraft()])}>
                <Plus className="h-3.5 w-3.5" />
                Ajouter une valeur
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRecordDialogZoneId(null)}>
              Annuler
            </Button>
            <Button onClick={saveRecord} disabled={busyKey === 'save-record'}>
              {busyKey === 'save-record' ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delegation / DNSSEC info panel */}
      <Dialog open={!!infoPanel} onOpenChange={(open) => !open && setInfoPanel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {infoPanel?.tab === 'delegation' ? 'Délégation' : 'DNSSEC'} — {infoPanel?.zone.name}
            </DialogTitle>
          </DialogHeader>
          {infoPanel?.loading ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : infoPanel?.tab === 'delegation' ? (
            <div className="space-y-4 text-sm">
              {infoPanel.delegation && infoPanel.delegation.nsHostnames.length > 0 && (
                <>
                  <div className="space-y-2">
                    <p className="text-muted-foreground">Nameservers de cette zone :</p>
                    {infoPanel.delegation.nsHostnames.map((host) => (
                      <div key={host} className="rounded-lg border border-white/[0.08] bg-zinc-950/60 px-3 py-2 font-mono">
                        {host}
                      </div>
                    ))}
                  </div>

                  {infoPanel.zone.name.split('.').length <= 2 ? (
                    <Callout variant="warning">
                      <strong>{infoPanel.zone.name}</strong> ressemble à un domaine racine — pour le déléguer
                      directement, ton registrar doit accepter d'y ajouter les <strong>glue records</strong>{' '}
                      (parfois appelés « host records » / « enregistrements hôte ») ci-dessous. Certains registrars ne
                      proposent pas cette option facilement.
                      <ul className="mt-2 space-y-1 font-mono text-xs">
                        {infoPanel.delegation.glue.map((g) => (
                          <li key={g.host}>
                            {g.host} → {g.ip}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2">
                        Alternative plus simple : recrée cette zone comme un{' '}
                        <strong>sous-domaine</strong> (ex : <code>dns.{infoPanel.zone.name}</code>) — tu n'as alors
                        besoin d'ajouter que des enregistrements A/NS classiques dans le DNS existant de ton domaine
                        principal, sans configuration spéciale chez le registrar.
                      </p>
                    </Callout>
                  ) : (
                    <Callout variant="info">
                      <strong>{infoPanel.zone.name}</strong> est un sous-domaine : pas de glue record nécessaire.
                      Dans le DNS existant de ton domaine principal (là où tu gères déjà ses enregistrements
                      aujourd'hui), ajoute simplement :
                      <ul className="mt-2 space-y-1 font-mono text-xs">
                        <li>
                          NS &nbsp;{infoPanel.zone.name} → {infoPanel.delegation.nsHostnames.join(', ')}
                        </li>
                        {infoPanel.delegation.glue.map((g) => (
                          <li key={g.host}>
                            A &nbsp;{g.host} → {g.ip}
                          </li>
                        ))}
                      </ul>
                    </Callout>
                  )}
                </>
              )}
              {(!infoPanel.delegation || infoPanel.delegation.nsHostnames.length === 0) && (
                <p className="text-muted-foreground">Ajoute au moins un serveur au groupe DNS de cette zone.</p>
              )}
            </div>
          ) : (
            <div className="space-y-4 text-sm">
              <p className="text-muted-foreground">
                Enregistre ce DS record chez ton registrar pour activer la validation DNSSEC de la chaîne de confiance.
              </p>
              {infoPanel?.dnssec?.dsRecords.length ? (
                infoPanel.dnssec.dsRecords.map((ds) => (
                  <div key={ds} className="rounded-lg border border-white/[0.08] bg-zinc-950/60 px-3 py-2 font-mono text-xs break-all">
                    {ds}
                  </div>
                ))
              ) : (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <XCircle className="h-4 w-4" />
                  Aucune clé disponible pour l'instant (le nœud primaire doit être en ligne et avoir appliqué la zone).
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Geo tab: reverse lookup for the clicked marker */}
      <Dialog open={!!geoPanel} onOpenChange={(open) => !open && setGeoPanel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enregistrements DNS pointant vers « {geoPanel?.node.name} »</DialogTitle>
          </DialogHeader>
          {geoPanel?.loading ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : geoPanel?.records && geoPanel.records.length > 0 ? (
            <div className="space-y-1.5">
              {geoPanel.records.map((record) => (
                <div
                  key={record.recordId}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.08] bg-zinc-950/50 p-2.5 text-sm"
                >
                  <span className="font-mono text-zinc-200">
                    {record.recordName === '@' ? record.zoneName : `${record.recordName}.${record.zoneName}`}
                  </span>
                  <Badge label={record.type} type="info" />
                  {record.isGeo && <Badge label="Géo-routage" type="success" />}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Aucun enregistrement DNS ne pointe vers ce nœud.</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
