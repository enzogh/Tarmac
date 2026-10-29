'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { Activity, Gauge, Globe2, Network, Plus, Radar, Send, type LucideIcon } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Tabs, TabsCount, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFirewall } from './FirewallContext';

type Tab = { slug: string; label: string; icon: LucideIcon };

const TABS: Tab[] = [
  { slug: '', label: 'Synthèse', icon: Gauge },
  { slug: 'servers', label: 'Entre serveurs', icon: Network },
  { slug: 'internet', label: 'Depuis Internet', icon: Globe2 },
  { slug: 'outbound', label: 'Vers Internet', icon: Send },
  { slug: 'activity', label: 'Activité', icon: Activity },
];

/**
 * The firewall is one page in the sidebar: a shared header and a tab rail,
 * each tab keeping its own URL so links into a given view keep working.
 * The header text is the same on every tab so the rail never shifts.
 */
export function FirewallShell({ children }: { children: ReactNode }) {
  const { workspace } = useParams<{ workspace: string }>();
  const pathname = usePathname() ?? '';
  const { data, openRule, openTest } = useFirewall();
  const base = `/${workspace}/dashboard/firewall`;
  const current = TABS.find((tab) => tab.slug && pathname.startsWith(`${base}/${tab.slug}`)) ?? TABS[0];
  // The dialogs can switch zone; the tab only picks the sensible default.
  const scope = current.slug === 'internet' ? 'public' : current.slug === 'outbound' ? 'outbound' : 'mesh';
  const toReview = data.settings.meshMode === 'observe' ? data.stats.observed24h : 0;

  // On narrow screens the rail scrolls: keep the active tab in view.
  const rail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = rail.current;
    const active = list?.querySelector<HTMLElement>('[data-state="active"]');
    if (!list || !active) return;
    const left = active.offsetLeft; // the rail is position: relative, so its own offsetParent
    if (left < list.scrollLeft || left + active.offsetWidth > list.scrollLeft + list.clientWidth) {
      list.scrollLeft = left + active.offsetWidth / 2 - list.clientWidth / 2;
    }
  }, [current.slug]);

  return (
    <>
      <div className="space-y-5">
        <PageHeader
          title="Pare-feu"
          description="Choisissez qui peut joindre vos serveurs, entre eux et depuis Internet, et ce qu’ils peuvent contacter. Chaque serveur applique lui-même ses règles."
          actionsReadOnlySafe
          actions={
            <>
              <Button variant="secondary" className="gap-1.5" onClick={() => openTest({ scope })} disabled={data.nodes.length === 0}>
                <Radar className="h-4 w-4" />
                Tester une connexion
              </Button>
              <Button write className="gap-1.5" onClick={() => openRule({ draft: { scope } })} disabled={data.nodes.length === 0}>
                <Plus className="h-4 w-4" />
                Nouvelle règle
              </Button>
            </>
          }
        />
        {data.nodes.length > 0 && (
          // Each tab is a real link: the value only drives the active style.
          <Tabs value={current.slug} activationMode="manual">
            <TabsList ref={rail} aria-label="Sections du pare-feu">
              {TABS.map((tab) => (
                <TabsTrigger key={tab.slug} value={tab.slug} asChild>
                  <Link href={tab.slug ? `${base}/${tab.slug}` : base}>
                    <tab.icon />
                    {tab.label}
                    {tab.slug === 'activity' && toReview > 0 && <TabsCount>{toReview.toLocaleString('fr-FR')}</TabsCount>}
                  </Link>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
      </div>
      {children}
    </>
  );
}
