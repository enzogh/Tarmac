'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  Activity,
  ArrowRightLeft,
  ChevronLeft,
  ChevronRight,
  Link2,
  Plus,
  Power,
  PowerOff,
  RadioTower,
  Search,
  ShieldCheck,
  Smartphone,
  Tag,
  Trash2,
  TriangleAlert,
  Waypoints,
  X,
} from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Callout } from '@/components/Callout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Stat, StatRow } from '@/components/ui/stat';
import { StatusPill } from '@/components/ui/status';
import { Tabs, TabsCount, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CardListSkeleton, StatCardSkeleton } from '@/components/ui/skeleton';
import { api, VpnBulkAction, VpnProfile } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { usePolling } from '@/lib/hooks/usePolling';
import { AccessDialog, BulkAccessDialog, LinkDialog, TagDialog } from './components/AccessDialogs';
import { ConfigDialog } from './components/ConfigPanel';
import { CreateProfileDialog } from './components/CreateProfileDialog';
import { EditProfileDialog } from './components/EditProfileDialog';
import { buildLinks, LinksPanel } from './components/LinksPanel';
import { ProfileDrawer } from './components/ProfileDrawer';
import { isLiveConnected, ProfileAction, ProfileTable, Sort, SortKey } from './components/ProfileTable';
import { profileStatus, ProfileStatusKey, useVpnLive } from './components/vpn-ui';

type Filter = 'all' | 'connected' | 'attention' | 'inactive';
type View = 'profiles' | 'links';

// What needs attention or is in use comes first; switched-off profiles sink
// to the bottom instead of sitting on top just because they're the newest.
const STATUS_RANK: Record<ProfileStatusKey, number> = {
  error: 0,
  connected: 1,
  pending: 2,
  ready: 3,
  disabled: 4,
  expired: 5,
};
const PAGE_SIZES = [25, 50, 100];
const ANY = '__any__';
type Notice = { tone: 'success' | 'danger'; message: string };

function EmptyState({ onCreate, canCreate }: { onCreate: () => void; canCreate: boolean }) {
  const steps = [
    { icon: RadioTower, title: "Choisissez un point d'entrée", text: "Le serveur auquel l'appareil se connecte." },
    { icon: ShieldCheck, title: 'Définissez ses accès', text: 'Internet, serveurs du réseau privé, autres appareils.' },
    { icon: Smartphone, title: "Installez sur l'appareil", text: 'Fichier ou QR code pour les applications WireGuard.' },
  ];
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-6 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <ShieldCheck className="h-6 w-6 text-primary" />
        </div>
        <div className="max-w-lg space-y-1">
          <h2 className="text-base font-semibold text-foreground">Donnez un accès VPN sécurisé à votre flotte</h2>
          <p className="text-sm text-muted-foreground">
            Chaque profil WireGuard relie un appareil à vos serveurs, et peut faire sortir sa navigation par le nœud de
            votre choix.
          </p>
        </div>
        <ol className="grid w-full max-w-3xl gap-3 sm:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title} className="rounded-lg border border-border bg-surface-2 p-4 text-left">
              <step.icon className="mb-2 h-4 w-4 text-primary" />
              <p className="text-sm font-medium text-foreground">
                {index + 1}. {step.title}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{step.text}</p>
            </li>
          ))}
        </ol>
        <Button write onClick={onCreate} disabled={!canCreate} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Créer mon premier profil
        </Button>
      </CardContent>
    </Card>
  );
}

function FilterSelect({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-auto min-w-[9rem] gap-2 text-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{placeholder}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function VpnProfilesPage() {
  const params = useParams<{ workspace: string }>();
  const { data: profiles = [], mutate, isLoading } = usePolling('vpn-profiles', api.vpn.list, { intervalMs: 10000 });
  const { data: gateways = [], mutate: mutateGateways } = usePolling('vpn-gateways', api.vpn.gateways, {
    intervalMs: 15000,
  });
  const live = useVpnLive(() => {
    void mutate();
    void mutateGateways();
  });

  const [view, setView] = useState<View>('profiles');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [entryFilter, setEntryFilter] = useState(ANY);
  const [tagFilter, setTagFilter] = useState(ANY);
  const [modeFilter, setModeFilter] = useState(ANY);
  const [sort, setSort] = useState<Sort>({ key: 'status', direction: 'asc' });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [createOpen, setCreateOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<VpnProfile | null>(null);
  const [accessFor, setAccessFor] = useState<VpnProfile | null>(null);
  const [bulkAccess, setBulkAccess] = useState<VpnProfile[] | null>(null);
  const [tagTargets, setTagTargets] = useState<VpnProfile[] | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkSources, setLinkSources] = useState<string[]>([]);
  const [installing, setInstalling] = useState<VpnProfile | null>(null);
  const [switching, setSwitching] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showNotice = (next: Notice) => {
    setNotice(next);
    clearTimeout(noticeTimer.current);
    if (next.tone === 'success') noticeTimer.current = setTimeout(() => setNotice(null), 6000);
  };
  const refresh = () => {
    void mutate();
    void mutateGateways();
  };

  const nodeNames = useMemo(() => new Map(gateways.map((gateway) => [gateway.id, gateway.name])), [gateways]);
  const profileNames = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile.name])), [profiles]);
  const knownTags = useMemo(() => [...new Set(profiles.flatMap((profile) => profile.tags))].sort((a, b) => a.localeCompare(b)), [profiles]);
  const entryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const profile of profiles) counts.set(profile.entryNode.id, (counts.get(profile.entryNode.id) ?? 0) + 1);
    return gateways
      .filter((gateway) => counts.has(gateway.id))
      .map((gateway) => ({ value: gateway.id, label: `${gateway.name} (${counts.get(gateway.id)})` }));
  }, [gateways, profiles]);

  const isConnected = (profile: VpnProfile) => isLiveConnected(profile, live[profile.id]) && profileStatus(profile).key !== 'disabled';
  const needsAttention = (profile: VpnProfile) => {
    const key = profileStatus(profile).key;
    return key === 'error' || key === 'pending' || Boolean(profile.deployment.warning);
  };
  const isInactive = (profile: VpnProfile) => !profile.enabled || profile.deployment.status === 'expired';
  const connectedCount = profiles.filter(isConnected).length;
  const attentionCount = profiles.filter(needsAttention).length;
  const inactiveCount = profiles.filter(isInactive).length;
  const eligibleEntries = gateways.filter((gateway) => gateway.entryEligibility === null);
  const totalTraffic = profiles.reduce((sum, profile) => {
    const session = live[profile.id];
    return sum + (session ? session.rxBytes + session.txBytes : profile.session.rxBytes + profile.session.txBytes);
  }, 0);
  const exitNodes = new Set(profiles.filter((p) => p.enabled && p.exitNode).map((p) => p.exitNode?.id)).size;
  const linkCount = useMemo(() => buildLinks(profiles).length, [profiles]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return profiles.filter((profile) => {
      if (filter === 'connected' && !isConnected(profile)) return false;
      if (filter === 'attention' && !needsAttention(profile)) return false;
      if (filter === 'inactive' && !isInactive(profile)) return false;
      if (entryFilter !== ANY && profile.entryNode.id !== entryFilter) return false;
      if (tagFilter !== ANY && !profile.tags.includes(tagFilter)) return false;
      if (modeFilter !== ANY && profile.mode !== modeFilter) return false;
      if (!needle) return true;
      return [profile.name, profile.description, profile.clientIp, profile.entryNode.name, profile.exitNode?.name, ...profile.tags]
        .filter(Boolean)
        .some((value) => (value as string).toLowerCase().includes(needle));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles, live, filter, query, entryFilter, tagFilter, modeFilter]);

  const sorted = useMemo(() => {
    const factor = sort.direction === 'asc' ? 1 : -1;
    const ipValue = (ip: string) => ip.split('.').reduce((total, octet) => total * 256 + Number(octet), 0);
    const activity = (profile: VpnProfile) => {
      const at = live[profile.id]?.lastHandshakeAt ?? profile.session.lastHandshakeAt;
      return at ? new Date(at).getTime() : 0;
    };
    const compare: Record<SortKey, (left: VpnProfile, right: VpnProfile) => number> = {
      status: (left, right) => STATUS_RANK[profileStatus(left).key] - STATUS_RANK[profileStatus(right).key],
      name: (left, right) => left.name.localeCompare(right.name),
      entry: (left, right) => left.entryNode.name.localeCompare(right.entryNode.name),
      ip: (left, right) => ipValue(left.clientIp) - ipValue(right.clientIp),
      activity: (left, right) => activity(right) - activity(left),
    };
    return [...filtered].sort((left, right) => factor * compare[sort.key](left, right) || left.name.localeCompare(right.name));
  }, [filtered, sort, live]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  useEffect(() => setPage(0), [filter, query, entryFilter, tagFilter, modeFilter, pageSize]);
  // Selection only ever holds profiles that still exist.
  useEffect(() => {
    setSelected((current) => {
      const ids = new Set(profiles.map((profile) => profile.id));
      const next = new Set([...current].filter((id) => ids.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [profiles]);

  const selectedProfiles = profiles.filter((profile) => selected.has(profile.id));
  const opened = profiles.find((profile) => profile.id === openId) ?? null;
  const filtersActive = filter !== 'all' || query || entryFilter !== ANY || tagFilter !== ANY || modeFilter !== ANY;

  const resetFilters = () => {
    setFilter('all');
    setQuery('');
    setEntryFilter(ANY);
    setTagFilter(ANY);
    setModeFilter(ANY);
  };

  const onSort = (key: SortKey) =>
    setSort((current) => (current.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' }));

  const switchExit = async (profile: VpnProfile, exitNodeId: string | null) => {
    setSwitching((current) => ({ ...current, [profile.id]: exitNodeId ?? '' }));
    try {
      const updated = await api.vpn.switchExit(profile.id, exitNodeId);
      await mutate((current) => current?.map((item) => (item.id === updated.id ? updated : item)), { revalidate: false });
      const target = updated.exitNode;
      setFlash((current) => ({
        ...current,
        [profile.id]: target ? `Sortie : ${target.name}${target.publicIp ? ` (${target.publicIp})` : ''}` : 'Sortie modifiée',
      }));
      setTimeout(() => setFlash(({ [profile.id]: _removed, ...rest }) => rest), 5000);
    } catch (caught) {
      showNotice({ tone: 'danger', message: caught instanceof Error ? caught.message : 'Le changement de sortie a échoué.' });
    } finally {
      setSwitching(({ [profile.id]: _removed, ...rest }) => rest);
    }
  };

  const handleAction = async (profile: VpnProfile, action: ProfileAction) => {
    try {
      if (action === 'open') setOpenId(profile.id);
      if (action === 'install') setInstalling(profile);
      if (action === 'edit') setEditing(profile);
      if (action === 'access') setAccessFor(profile);
      if (action === 'toggle') {
        await api.vpn.update(profile.id, { enabled: !profile.enabled });
        showNotice({
          tone: 'success',
          message: profile.enabled
            ? `« ${profile.name} » est désactivé : l'appareil ne peut plus se connecter.`
            : `« ${profile.name} » est réactivé.`,
        });
        await mutate();
      }
      if (action === 'rotate') {
        const confirmed = window.confirm(
          `Régénérer les clés de « ${profile.name} » ?\n\nLa configuration actuelle cessera immédiatement de fonctionner : il faudra installer la nouvelle sur l'appareil.`,
        );
        if (!confirmed) return;
        await api.vpn.rotateKeys(profile.id);
        await mutate();
        setInstalling(profile);
      }
      if (action === 'delete') {
        if (!window.confirm(`Supprimer définitivement le profil « ${profile.name} » ? L'appareil sera déconnecté.`)) return;
        await api.vpn.remove(profile.id);
        if (openId === profile.id) setOpenId(null);
        showNotice({ tone: 'success', message: `Profil « ${profile.name} » supprimé.` });
        await mutate();
      }
    } catch (caught) {
      showNotice({ tone: 'danger', message: caught instanceof Error ? caught.message : "L'action a échoué." });
    }
  };

  const runBulk = async (action: Extract<VpnBulkAction, 'enable' | 'disable' | 'delete'>) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (
      action === 'delete' &&
      !window.confirm(`Supprimer définitivement ${ids.length} profil(s) ? Les appareils concernés seront déconnectés.`)
    ) {
      return;
    }
    setBulkBusy(true);
    try {
      const { count } = await api.vpn.bulk(ids, action);
      const verb = action === 'enable' ? 'réactivé(s)' : action === 'disable' ? 'désactivé(s)' : 'supprimé(s)';
      showNotice({ tone: 'success', message: `${count} profil(s) ${verb}.` });
      if (action === 'delete') setSelected(new Set());
      refresh();
    } catch (caught) {
      showNotice({ tone: 'danger', message: caught instanceof Error ? caught.message : "L'action groupée a échoué." });
    } finally {
      setBulkBusy(false);
    }
  };

  const onDone = (message: string) => {
    showNotice({ tone: 'success', message });
    refresh();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profils VPN"
        description="Accès WireGuard à votre flotte : par où chaque appareil entre, par où il sort sur Internet, et ce qu'il a le droit de joindre."
        meta={
          connectedCount > 0 ? (
            <StatusPill tone="ok">
              {connectedCount} connecté{connectedCount > 1 ? 's' : ''}
            </StatusPill>
          ) : undefined
        }
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link href={`/${params.workspace}/dashboard/vpn/gateways`} className="gap-1.5">
                <RadioTower className="h-4 w-4" />
                Passerelles
              </Link>
            </Button>
            <Button write onClick={() => setCreateOpen(true)} disabled={eligibleEntries.length === 0} className="gap-1.5">
              <Plus className="h-4 w-4" />
              Nouveau profil
            </Button>
          </>
        }
      />

      {notice && <Callout variant={notice.tone}>{notice.message}</Callout>}

      {!isLoading && gateways.length > 0 && eligibleEntries.length === 0 && (
        <Callout variant="warning">
          Aucun nœud ne peut encore servir de point d&apos;entrée : un nœud doit avoir rejoint le réseau privé et publié
          son adresse publique. Consultez la page{' '}
          <Link href={`/${params.workspace}/dashboard/vpn/gateways`} className="underline">
            Passerelles
          </Link>{' '}
          pour le détail.
        </Callout>
      )}

      {isLoading ? (
        <StatRow>
          {Array.from({ length: 4 }).map((_, index) => (
            <StatCardSkeleton key={index} />
          ))}
        </StatRow>
      ) : profiles.length > 0 ? (
        <StatRow className="animate-fade-in">
          <Stat label="Profils" value={profiles.length} icon={ShieldCheck} hint={`${profiles.length - inactiveCount} actif(s)`} />
          <Stat
            label="Connectés maintenant"
            value={connectedCount}
            icon={Activity}
            tone={connectedCount > 0 ? 'ok' : 'neutral'}
            hint="Handshake il y a moins de 3 min"
          />
          <Stat
            label="À surveiller"
            value={attentionCount}
            icon={TriangleAlert}
            tone={attentionCount > 0 ? 'warn' : 'ok'}
            hint={attentionCount > 0 ? 'Erreur, déploiement en cours ou agent à mettre à jour' : 'Tout est déployé'}
          />
          <Stat
            label="Trafic des sessions"
            value={formatBytes(totalTraffic)}
            icon={ArrowRightLeft}
            hint={`${exitNodes} nœud(s) de sortie · ${eligibleEntries.length} entrée(s) dispo.`}
          />
        </StatRow>
      ) : null}

      {isLoading ? (
        <CardListSkeleton cards={2} />
      ) : profiles.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} canCreate={eligibleEntries.length > 0} />
      ) : (
        <div className="space-y-3">
          <Tabs value={view} onValueChange={(value) => setView(value as View)}>
            <TabsList>
              <TabsTrigger value="profiles" className="gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" />
                Profils <TabsCount>{profiles.length}</TabsCount>
              </TabsTrigger>
              <TabsTrigger value="links" className="gap-1.5">
                <Link2 className="h-3.5 w-3.5" />
                Liens d&apos;accès <TabsCount>{linkCount}</TabsCount>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {view === 'links' ? (
            <LinksPanel
              profiles={profiles}
              onCreate={() => {
                setLinkSources([]);
                setLinkOpen(true);
              }}
              onOpenProfile={(profile) => setOpenId(profile.id)}
              onChanged={onDone}
              onError={(message) => showNotice({ tone: 'danger', message })}
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)}>
                  <TabsList variant="segmented">
                    <TabsTrigger value="all">
                      Tous <TabsCount>{profiles.length}</TabsCount>
                    </TabsTrigger>
                    <TabsTrigger value="connected">
                      Connectés <TabsCount>{connectedCount}</TabsCount>
                    </TabsTrigger>
                    <TabsTrigger value="attention">
                      À surveiller <TabsCount>{attentionCount}</TabsCount>
                    </TabsTrigger>
                    <TabsTrigger value="inactive">
                      Inactifs <TabsCount>{inactiveCount}</TabsCount>
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Nom, libellé, nœud ou IP…"
                    className="h-8 pl-8"
                  />
                </div>
                {entryOptions.length > 1 && (
                  <FilterSelect value={entryFilter} onChange={setEntryFilter} placeholder="Tous les points d'entrée" options={entryOptions} />
                )}
                {knownTags.length > 0 && (
                  <FilterSelect
                    value={tagFilter}
                    onChange={setTagFilter}
                    placeholder="Tous les libellés"
                    options={knownTags.map((tag) => ({ value: tag, label: tag }))}
                  />
                )}
                <FilterSelect
                  value={modeFilter}
                  onChange={setModeFilter}
                  placeholder="Tous les modes"
                  options={[
                    { value: 'full', label: 'VPN complet' },
                    { value: 'private', label: 'Réseau privé' },
                  ]}
                />
                {filtersActive && (
                  <Button variant="ghost" size="sm" onClick={resetFilters} className="gap-1">
                    <X className="h-3.5 w-3.5" />
                    Réinitialiser
                  </Button>
                )}
              </div>

              {selected.size > 0 && (
                <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-popover/95 px-3 py-2 shadow-overlay backdrop-blur animate-fade-in">
                  <span className="text-sm font-medium text-foreground">
                    {selected.size} sélectionné{selected.size > 1 ? 's' : ''}
                  </span>
                  {selected.size < sorted.length && (
                    <button
                      type="button"
                      onClick={() => setSelected(new Set(sorted.map((profile) => profile.id)))}
                      className="text-xs text-primary hover:underline"
                    >
                      Sélectionner les {sorted.length} résultats
                    </button>
                  )}
                  <span className="mx-1 h-5 w-px bg-border" />
                  <Button write size="sm" variant="secondary" onClick={() => setBulkAccess(selectedProfiles)} disabled={bulkBusy} className="gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Accès
                  </Button>
                  <Button write
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setLinkSources([...selected]);
                      setLinkOpen(true);
                    }}
                    disabled={bulkBusy}
                    className="gap-1.5"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    Relier
                  </Button>
                  <Button write size="sm" variant="secondary" onClick={() => setTagTargets(selectedProfiles)} disabled={bulkBusy} className="gap-1.5">
                    <Tag className="h-3.5 w-3.5" />
                    Libellé
                  </Button>
                  <Button write size="sm" variant="secondary" onClick={() => void runBulk('enable')} disabled={bulkBusy} className="gap-1.5">
                    <Power className="h-3.5 w-3.5" />
                    Activer
                  </Button>
                  <Button write size="sm" variant="secondary" onClick={() => void runBulk('disable')} disabled={bulkBusy} className="gap-1.5">
                    <PowerOff className="h-3.5 w-3.5" />
                    Désactiver
                  </Button>
                  <Button write
                    size="sm"
                    variant="secondary"
                    onClick={() => void runBulk('delete')}
                    disabled={bulkBusy}
                    className="gap-1.5 text-[hsl(var(--danger))]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Supprimer
                  </Button>
                  <span className="flex-1" />
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} aria-label="Vider la sélection">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}

              <Card className="overflow-hidden">
                {sorted.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-12 text-center">
                    <p className="text-sm text-muted-foreground">Aucun profil ne correspond à ces filtres.</p>
                    <Button variant="secondary" size="sm" onClick={resetFilters}>
                      Réinitialiser les filtres
                    </Button>
                  </div>
                ) : (
                  <>
                    <ProfileTable
                      profiles={pageRows}
                      live={live}
                      selected={selected}
                      onSelectedChange={setSelected}
                      sort={sort}
                      onSort={onSort}
                      nodeNames={nodeNames}
                      profileNames={profileNames}
                      onAction={(profile, action) => void handleAction(profile, action)}
                      activeId={openId}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
                      <span>
                        {currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, sorted.length)} sur {sorted.length}
                        {sorted.length !== profiles.length && ` (filtrés parmi ${profiles.length})`}
                      </span>
                      <div className="flex items-center gap-2">
                        <span>Par page</span>
                        <Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))}>
                          <SelectTrigger className="h-7 w-[4.5rem] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PAGE_SIZES.map((size) => (
                              <SelectItem key={size} value={String(size)}>
                                {size}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setPage(currentPage - 1)}
                          disabled={currentPage === 0}
                          aria-label="Page précédente"
                          className="h-7 w-7"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="tabular-nums">
                          {currentPage + 1} / {pageCount}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setPage(currentPage + 1)}
                          disabled={currentPage >= pageCount - 1}
                          aria-label="Page suivante"
                          className="h-7 w-7"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </Card>
              <p className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                <Waypoints className="h-3 w-3" />
                Cliquez sur un profil pour voir son trajet, changer sa sortie et ses accès.
              </p>
            </>
          )}
        </div>
      )}

      <ProfileDrawer
        profile={opened}
        profiles={profiles}
        gateways={gateways}
        live={opened ? live[opened.id] : undefined}
        switchingTo={opened ? (switching[opened.id] ?? null) : null}
        flash={opened ? flash[opened.id] : null}
        onOpenChange={(open) => !open && setOpenId(null)}
        onSwitchExit={(exitNodeId) => opened && void switchExit(opened, exitNodeId)}
        onAction={(action) => opened && void handleAction(opened, action)}
        onOpenProfile={(profile) => setOpenId(profile.id)}
      />
      <CreateProfileDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        gateways={gateways}
        profiles={profiles}
        onCreated={refresh}
      />
      <EditProfileDialog
        profile={editing}
        gateways={gateways}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={(message) => {
          showNotice({ tone: 'success', message });
          void mutate();
        }}
      />
      <AccessDialog
        profile={accessFor}
        gateways={gateways}
        profiles={profiles}
        onOpenChange={(open) => !open && setAccessFor(null)}
        onSaved={onDone}
      />
      <BulkAccessDialog targets={bulkAccess} gateways={gateways} onOpenChange={(open) => !open && setBulkAccess(null)} onDone={onDone} />
      <TagDialog targets={tagTargets} knownTags={knownTags} onOpenChange={(open) => !open && setTagTargets(null)} onDone={onDone} />
      <LinkDialog open={linkOpen} profiles={profiles} initialSources={linkSources} onOpenChange={setLinkOpen} onDone={onDone} />
      <ConfigDialog profile={installing} onOpenChange={(open) => !open && setInstalling(null)} />
    </div>
  );
}
