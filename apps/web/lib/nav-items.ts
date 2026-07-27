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
  UserCog,
  type LucideIcon,
} from 'lucide-react';

export type NavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean };
export type NavGroup = { label: string | null; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [{ href: '/dashboard', label: "Vue d'ensemble", icon: LayoutDashboard, exact: true }],
  },
  {
    label: 'Infrastructure',
    items: [
      { href: '/dashboard/infrastructure', label: 'Nœuds', icon: Server },
      { href: '/dashboard/network', label: 'Réseau', icon: Network },
    ],
  },
  {
    label: 'Stockage',
    items: [
      { href: '/dashboard/storage', label: 'Stockage', icon: Database },
      { href: '/dashboard/mounts', label: 'Montages', icon: HardDrive },
      { href: '/dashboard/replication', label: 'Réplication', icon: RefreshCw },
      { href: '/dashboard/migrations', label: 'Migrations', icon: ArrowRightLeft },
    ],
  },
  {
    label: 'Supervision',
    items: [
      { href: '/dashboard/alerts', label: 'Alertes', icon: Bell },
      { href: '/dashboard/logs', label: 'Journal', icon: ScrollText },
    ],
  },
  {
    label: 'Compte',
    items: [{ href: '/dashboard/profile', label: 'Profil admin', icon: UserCog }],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);
