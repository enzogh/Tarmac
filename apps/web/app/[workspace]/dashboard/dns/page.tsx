'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Globe, MapPin, Plus, Server } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Callout } from '@/components/Callout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CardListSkeleton } from '@/components/ui/skeleton';
import { Tabs, TabsCount, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { GeoMapSection } from './components/GeoMapSection';
import { GroupDialog } from './components/GroupDialog';
import { GroupsSection } from './components/GroupsSection';
import { DnsNotice, useDnsPageState } from './components/useDnsPageState';
import { ZoneDetail, ZoneView } from './components/ZoneDetail';
import { ZoneDialog } from './components/ZoneDialog';
import { ZoneList } from './components/ZoneList';

type PageTab = 'domains' | 'servers' | 'map';
const ZONE_VIEWS: ZoneView[] = ['records', 'nameservers', 'dnssec', 'journal'];

function GettingStarted({ hasGroups, onCreateGroup, onAddDomain }: { hasGroups: boolean; onCreateGroup: () => void; onAddDomain: () => void }) {
  const steps = [
    {
      title: 'Choisissez vos serveurs DNS',
      text: 'Un groupe = un serveur primaire et jusqu’à 3 secondaires de votre flotte, qui répondent pour vos domaines.',
      done: hasGroups,
      action: !hasGroups ? { label: 'Créer un groupe', onClick: onCreateGroup } : null,
    },
    {
      title: 'Ajoutez un domaine',
      text: 'Ses enregistrements se gèrent ici, et sont appliqués sur tous les serveurs du groupe.',
      done: false,
      action: hasGroups ? { label: 'Ajouter un domaine', onClick: onAddDomain } : null,
    },
    {
      title: 'Déléguez-le chez votre registrar',
      text: 'Tarmac vous indique les nameservers à renseigner et vérifie la délégation automatiquement.',
      done: false,
      action: null,
    },
  ];
  return (
    <Card>
      <CardContent className="space-y-6 py-10">
        <div className="mx-auto max-w-xl text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <Globe className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-base font-semibold text-foreground">Hébergez le DNS de vos domaines sur votre flotte</h2>
          <p className="mt-1 text-sm text-muted-foreground">Trois étapes, sans quitter cette page.</p>
        </div>
        <ol className="mx-auto grid max-w-4xl gap-3 md:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title} className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-4">
              <span
                className={
                  step.done
                    ? 'flex h-6 w-6 items-center justify-center rounded-full bg-[hsl(var(--ok))]/15 text-xs font-semibold text-[hsl(var(--ok))]'
                    : 'flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary'
                }
              >
                {step.done ? '✓' : index + 1}
              </span>
              <p className="text-sm font-medium text-foreground">{step.title}</p>
              <p className="flex-1 text-xs text-muted-foreground">{step.text}</p>
              {step.action && (
                <Button write size="sm" onClick={step.action.onClick} className="mt-1 w-fit gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  {step.action.label}
                </Button>
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function DnsPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { nodes, groups, zones, vlanId, groupsLoading, zonesLoading, refreshGroups, refreshZones, notice, setNotice, busyKey, setBusyKey, journal } =
    useDnsPageState();

  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [zoneDialogOpen, setZoneDialogOpen] = useState(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Navigation lives in the URL (?tab=, ?zone=, ?view=) so a domain can be
  // linked to, reloaded, and left with the browser's back button.
  const tab = (searchParams.get('tab') as PageTab) ?? 'domains';
  const zoneId = searchParams.get('zone');
  const viewParam = searchParams.get('view') as ZoneView | null;
  const view: ZoneView = viewParam && ZONE_VIEWS.includes(viewParam) ? viewParam : 'records';
  const zone = zoneId ? zones.find((candidate) => candidate.id === zoneId) : undefined;

  const navigate = (params: Record<string, string | null>, push = false) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(params)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    const url = next.toString() ? `${pathname}?${next.toString()}` : pathname;
    if (push) router.push(url, { scroll: false });
    else router.replace(url, { scroll: false });
  };

  const showNotice = (next: DnsNotice) => {
    setNotice(next);
    clearTimeout(noticeTimer.current);
    if (next?.type === 'success') noticeTimer.current = setTimeout(() => setNotice(null), 5000);
  };

  // A deleted (or unknown) zone in the URL falls back to the list.
  useEffect(() => {
    if (zoneId && !zonesLoading && !zone) {
      const timer = setTimeout(() => navigate({ zone: null, view: null }), 0);
      return () => clearTimeout(timer);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneId, zone, zonesLoading]);

  const loading = groupsLoading || zonesLoading;
  const addDomainButton =
    groups.length === 0 ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button write disabled className="gap-1.5">
              <Plus className="h-4 w-4" />
              Ajouter un domaine
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Créez d&apos;abord un groupe de serveurs DNS.</TooltipContent>
      </Tooltip>
    ) : (
      <Button write onClick={() => setZoneDialogOpen(true)} className="gap-1.5">
        <Plus className="h-4 w-4" />
        Ajouter un domaine
      </Button>
    );

  return (
    <div className="space-y-6">
      {!zone && (
        <PageHeader
          title="DNS"
          description="Vos domaines, servis par vos propres serveurs : enregistrements, délégation, DNSSEC et géo-routage."
          actions={
            tab === 'servers' ? (
              <Button write onClick={() => setGroupDialogOpen(true)} className="gap-1.5">
                <Plus className="h-4 w-4" />
                Nouveau groupe de serveurs
              </Button>
            ) : (
              addDomainButton
            )
          }
        />
      )}

      {notice && <Callout variant={notice.type === 'error' ? 'danger' : 'success'}>{notice.message}</Callout>}

      {zone ? (
        <ZoneDetail
          zone={zone}
          group={groups.find((group) => group.id === zone.groupId)}
          nodes={nodes}
          journal={journal}
          view={view}
          onViewChange={(next) => navigate({ view: next === 'records' ? null : next })}
          onBack={() => navigate({ zone: null, view: null }, true)}
          onChanged={refreshZones}
          onDeleted={(message) => {
            showNotice({ type: 'success', message });
            navigate({ zone: null, view: null });
            void refreshZones();
            void refreshGroups();
          }}
          onNotice={showNotice}
        />
      ) : (
        <>
          <Tabs value={tab} onValueChange={(next) => navigate({ tab: next === 'domains' ? null : next })}>
            <TabsList>
              <TabsTrigger value="domains" className="gap-1.5">
                <Globe className="h-3.5 w-3.5" />
                Domaines <TabsCount>{zones.length}</TabsCount>
              </TabsTrigger>
              <TabsTrigger value="servers" className="gap-1.5">
                <Server className="h-3.5 w-3.5" />
                Serveurs DNS <TabsCount>{groups.length}</TabsCount>
              </TabsTrigger>
              <TabsTrigger value="map" className="gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                Carte
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {tab === 'domains' &&
            (loading ? (
              <CardListSkeleton cards={3} />
            ) : zones.length === 0 ? (
              <GettingStarted
                hasGroups={groups.length > 0}
                onCreateGroup={() => setGroupDialogOpen(true)}
                onAddDomain={() => setZoneDialogOpen(true)}
              />
            ) : (
              <ZoneList zones={zones} groups={groups} onOpen={(id) => navigate({ zone: id, view: null }, true)} />
            ))}

          {tab === 'servers' && (
            <GroupsSection
              groups={groups}
              groupsLoading={groupsLoading}
              nodes={nodes}
              vlanId={vlanId}
              busyKey={busyKey}
              setBusyKey={setBusyKey}
              setNotice={showNotice}
              refreshGroups={refreshGroups}
              journal={journal}
            />
          )}

          {tab === 'map' && <GeoMapSection nodes={nodes} groups={groups} zones={zones} />}
        </>
      )}

      <GroupDialog
        open={groupDialogOpen}
        onOpenChange={setGroupDialogOpen}
        nodes={nodes}
        groups={groups}
        onCreated={async () => {
          await refreshGroups();
        }}
        onNotice={showNotice}
      />
      <ZoneDialog
        open={zoneDialogOpen}
        onOpenChange={setZoneDialogOpen}
        groups={groups}
        onCreated={async (created) => {
          showNotice({ type: 'success', message: `${created.name} ajouté. Dernière étape : le déléguer à vos serveurs.` });
          // Refetch first: opening a zone the list doesn't know yet would
          // bounce straight back to the list.
          await Promise.all([refreshZones(), refreshGroups()]);
          navigate({ zone: created.id, view: 'nameservers', tab: null }, true);
        }}
      />
    </div>
  );
}

export default function DnsPage() {
  return (
    <Suspense fallback={<CardListSkeleton cards={3} />}>
      <DnsPageContent />
    </Suspense>
  );
}
