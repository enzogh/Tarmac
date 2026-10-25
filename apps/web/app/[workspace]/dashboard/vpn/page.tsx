'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Activity, ArrowRightLeft, Plus, RadioTower, Search, ShieldCheck, Smartphone, Waypoints } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Callout } from '@/components/Callout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Stat, StatRow } from '@/components/ui/stat';
import { StatusPill } from '@/components/ui/status';
import { Tabs, TabsCount, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CardListSkeleton, StatCardSkeleton } from '@/components/ui/skeleton';
import { api, VpnProfile } from '@/lib/api';
import { formatBytes } from '@/lib/format';
import { usePolling } from '@/lib/hooks/usePolling';
import { ConfigDialog } from './components/ConfigPanel';
import { CreateProfileDialog } from './components/CreateProfileDialog';
import { EditProfileDialog } from './components/EditProfileDialog';
import { ProfileAction, ProfileCard } from './components/ProfileCard';
import { profileStatus, ProfileStatusKey, useVpnLive } from './components/vpn-ui';

type Filter = 'all' | 'connected' | 'inactive';

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
type Notice = { tone: 'success' | 'danger'; message: string };

function EmptyState({ onCreate, canCreate }: { onCreate: () => void; canCreate: boolean }) {
  const steps = [
    { icon: RadioTower, title: "Choisissez un point d'entrée", text: "Le serveur auquel l'appareil se connecte." },
    { icon: ArrowRightLeft, title: 'Choisissez la sortie', text: "L'IP publique utilisée sur Internet, modifiable en un clic." },
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
        <Button onClick={onCreate} disabled={!canCreate} className="gap-1.5">
          <Plus className="h-4 w-4" />
          Créer mon premier profil
        </Button>
      </CardContent>
    </Card>
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

  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<VpnProfile | null>(null);
  const [installing, setInstalling] = useState<VpnProfile | null>(null);
  const [switching, setSwitching] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>();

  const showNotice = (next: Notice) => {
    setNotice(next);
    clearTimeout(noticeTimer.current);
    if (next.tone === 'success') noticeTimer.current = setTimeout(() => setNotice(null), 6000);
  };

  const isConnected = (profile: VpnProfile) => profileStatus(profile).key === 'connected';
  const connectedCount = profiles.filter(isConnected).length;
  const inactiveCount = profiles.filter((profile) => !profile.enabled || profile.deployment.status === 'expired').length;
  const eligibleEntries = gateways.filter((gateway) => gateway.entryEligibility === null);
  const totalTraffic = profiles.reduce((sum, profile) => {
    const session = live[profile.id];
    return sum + (session ? session.rxBytes + session.txBytes : profile.session.rxBytes + profile.session.txBytes);
  }, 0);
  const exitNodes = new Set(profiles.filter((p) => p.enabled && p.exitNode).map((p) => p.exitNode?.id)).size;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rank = (profile: VpnProfile) => STATUS_RANK[profileStatus(profile).key];
    const sorted = [...profiles].sort((left, right) => rank(left) - rank(right) || left.name.localeCompare(right.name));
    return sorted.filter((profile) => {
      if (filter === 'connected' && !isConnected(profile)) return false;
      if (filter === 'inactive' && profile.enabled && profile.deployment.status !== 'expired') return false;
      if (!needle) return true;
      return [profile.name, profile.description, profile.clientIp, profile.entryNode.name, profile.exitNode?.name]
        .filter(Boolean)
        .some((value) => (value as string).toLowerCase().includes(needle));
    });
  }, [profiles, filter, query]);

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
      if (action === 'install') setInstalling(profile);
      if (action === 'edit') setEditing(profile);
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
        showNotice({ tone: 'success', message: `Profil « ${profile.name} » supprimé.` });
        await mutate();
      }
    } catch (caught) {
      showNotice({ tone: 'danger', message: caught instanceof Error ? caught.message : "L'action a échoué." });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Profils VPN"
        description="Accès WireGuard à votre flotte. Chaque profil se connecte par un nœud d'entrée et peut sortir sur Internet par n'importe quel autre nœud, modifiable en un clic sans déconnecter l'appareil."
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
            <Button onClick={() => setCreateOpen(true)} disabled={eligibleEntries.length === 0} className="gap-1.5">
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
          <Stat label="Nœuds de sortie utilisés" value={exitNodes} icon={Waypoints} hint={`${eligibleEntries.length} point(s) d'entrée disponible(s)`} />
          <Stat label="Trafic des sessions" value={formatBytes(totalTraffic)} icon={ArrowRightLeft} hint="Volume cumulé des sessions" />
        </StatRow>
      ) : null}

      {isLoading ? (
        <CardListSkeleton cards={2} />
      ) : profiles.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} canCreate={eligibleEntries.length > 0} />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)}>
              <TabsList variant="segmented">
                <TabsTrigger value="all">
                  Tous <TabsCount>{profiles.length}</TabsCount>
                </TabsTrigger>
                <TabsTrigger value="connected">
                  Connectés <TabsCount>{connectedCount}</TabsCount>
                </TabsTrigger>
                <TabsTrigger value="inactive">
                  Inactifs <TabsCount>{inactiveCount}</TabsCount>
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Profil, nœud ou IP…"
                className="h-8 w-60 pl-8"
              />
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Aucun profil ne correspond à ces filtres.</p>
          ) : (
            visible.map((profile) => (
              <ProfileCard
                key={profile.id}
                profile={profile}
                gateways={gateways}
                live={live[profile.id]}
                switchingTo={switching[profile.id] ?? null}
                flash={flash[profile.id]}
                onSwitchExit={(exitNodeId) => void switchExit(profile, exitNodeId)}
                onAction={(action) => void handleAction(profile, action)}
              />
            ))
          )}
        </div>
      )}

      <CreateProfileDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        gateways={gateways}
        onCreated={() => {
          void mutate();
          void mutateGateways();
        }}
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
      <ConfigDialog profile={installing} onOpenChange={(open) => !open && setInstalling(null)} />
    </div>
  );
}
