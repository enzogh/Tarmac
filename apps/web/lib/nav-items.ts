import {
  LayoutDashboard,
  LayoutGrid,
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
  type LucideIcon,
} from 'lucide-react';

export type NavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean };
// A null label renders as an ungrouped, non-collapsible top-level item
// (e.g. "Vue d'ensemble"); a real label (plus its own `icon`) renders as a
// collapsible section (see NavGroupSection in DashboardLayout.tsx).
export type NavGroup = { label: string | null; icon?: LucideIcon; items: NavItem[] };

// Every dashboard page now lives under /<workspace-slug>/dashboard/... - the
// nav is built per-render from the active workspace's slug so links always
// point at the workspace currently open, instead of a fixed global path.
export function buildNavGroups(slug: string): NavGroup[] {
  const base = `/${slug}/dashboard`;
  return [
    {
      label: null,
      items: [
        { href: '/workspaces', label: 'Mes workspaces', icon: LayoutGrid },
        { href: base, label: "Vue d'ensemble", icon: LayoutDashboard, exact: true },
        { href: `${base}/settings`, label: 'Paramètres', icon: Settings },
      ],
    },
    {
      label: 'Infrastructure',
      icon: Server,
      items: [
        { href: `${base}/infrastructure`, label: 'Nœuds', icon: Server },
        { href: `${base}/network`, label: 'Réseau', icon: Network },
        { href: `${base}/dns`, label: 'DNS', icon: Globe },
      ],
    },
    {
      label: 'Stockage',
      icon: Database,
      items: [
        { href: `${base}/storage`, label: 'Stockage', icon: Database },
        { href: `${base}/mounts`, label: 'Montages', icon: HardDrive },
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
  ];
}

export function buildNavItems(slug: string): NavItem[] {
  return buildNavGroups(slug).flatMap((group) => group.items);
}
