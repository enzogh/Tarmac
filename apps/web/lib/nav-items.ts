import {
  LayoutDashboard,
  Server,
  Database,
  RefreshCw,
  ArrowRightLeft,
  Bell,
  Network,
  HardDrive,
  ScrollText,
  Activity,
  Settings,
  Globe,
  ShieldCheck,
  KeyRound,
  RadioTower,
  SlidersHorizontal,
  BrickWallFire,
  Gauge,
  Globe2,
  type LucideIcon,
} from 'lucide-react';

import { areaOfPath, type PageArea } from './access';

export type NavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean; area?: PageArea | null };
// A null label renders as an ungrouped, non-collapsible top-level item
// (e.g. "Vue d'ensemble"); a real label (plus its own `icon`) renders as a
// collapsible section (see NavGroupSection in DashboardLayout.tsx).
export type NavGroup = { label: string | null; icon?: LucideIcon; items: NavItem[] };

// Every dashboard page now lives under /<workspace-slug>/dashboard/... - the
// nav is built per-render from the active workspace's slug so links always
// point at the workspace currently open, instead of a fixed global path.
//
// Grouped by what the operator is trying to do rather than by resource
// type: run the fleet (Infrastructure), give people access to it (Accès
// distant), store and move data (Stockage / Transferts), watch it
// (Supervision), and configure the workspace itself (Administration, at the
// bottom where settings conventionally live).
export function buildNavGroups(slug: string): NavGroup[] {
  const base = `/${slug}/dashboard`;
  return [
    {
      label: null,
      items: [{ href: base, label: "Vue d'ensemble", icon: LayoutDashboard, exact: true }],
    },
    {
      label: 'Infrastructure',
      icon: Server,
      items: [
        { href: `${base}/infrastructure`, label: 'Nœuds', icon: Server },
        { href: `${base}/network`, label: 'Réseau privé', icon: Network },
        { href: `${base}/dns`, label: 'DNS', icon: Globe },
      ],
    },
    {
      label: 'Pare-feu',
      icon: BrickWallFire,
      items: [
        // exact: the sub-pages are their own entries.
        { href: `${base}/firewall`, label: 'Synthèse', icon: Gauge, exact: true },
        { href: `${base}/firewall/servers`, label: 'Entre serveurs', icon: Network },
        { href: `${base}/firewall/internet`, label: 'Depuis Internet', icon: Globe2 },
        { href: `${base}/firewall/activity`, label: 'Activité', icon: Activity },
      ],
    },
    {
      label: 'Accès distant',
      icon: ShieldCheck,
      items: [
        // exact: /vpn/gateways is its own nav entry, not a sub-page of this one.
        { href: `${base}/vpn`, label: 'Profils VPN', icon: ShieldCheck, exact: true },
        { href: `${base}/vpn/gateways`, label: 'Passerelles', icon: RadioTower },
      ],
    },
    {
      label: 'Stockage',
      icon: Database,
      items: [
        { href: `${base}/storage`, label: 'Stockage', icon: Database },
        { href: `${base}/mounts`, label: 'Montages', icon: HardDrive },
      ],
    },
    {
      label: 'Transferts',
      icon: ArrowRightLeft,
      items: [
        { href: `${base}/replication`, label: 'Réplication', icon: RefreshCw },
        { href: `${base}/migrations`, label: 'Migrations', icon: ArrowRightLeft },
      ],
    },
    {
      label: 'Supervision',
      icon: Activity,
      items: [
        { href: `${base}/alerts`, label: 'Alertes', icon: Bell },
        { href: `${base}/logs`, label: 'Journal', icon: ScrollText },
      ],
    },
    {
      label: 'Administration',
      icon: SlidersHorizontal,
      items: [
        { href: `${base}/settings`, label: 'Paramètres', icon: Settings },
        { href: `${base}/api-keys`, label: 'Clés API', icon: KeyRound },
      ],
    },
  ];
}

export function buildNavItems(slug: string): NavItem[] {
  return buildNavGroups(slug).flatMap((group) => group.items);
}

/**
 * Drops what the current member's role doesn't reach (and the groups left
 * empty), so nobody is shown a page that would only answer "access denied".
 */
export function visibleNavGroups(groups: NavGroup[], canSee: (item: NavItem) => boolean): NavGroup[] {
  return groups
    .map((group) => ({ ...group, items: group.items.filter(canSee) }))
    .filter((group) => group.items.length > 0);
}

export function navItemArea(item: NavItem): PageArea | null {
  return item.area !== undefined ? item.area : areaOfPath(item.href);
}
