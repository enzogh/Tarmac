'use client';

import { useRouter } from 'next/navigation';
import { BellRing, BookOpen, ChevronsUpDown, LayoutGrid, LogOut, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { useWorkspace } from '../lib/workspace-context';
import { cn } from '../lib/utils';
import { useControlVersion } from './VersionBadge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

function userInitials(name?: string | null, email?: string) {
  const source = (name || email || '?').trim();
  const words = source.split(/[\s@._-]+/).filter(Boolean);
  return ((words[0]?.[0] ?? '?') + (words[1]?.[0] ?? '')).toUpperCase();
}

export function UserAvatar({
  name,
  email,
  avatarUrl,
  className,
}: {
  name?: string | null;
  email?: string;
  avatarUrl?: string | null;
  className?: string;
}) {
  if (avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={avatarUrl} alt="" className={cn('h-8 w-8 shrink-0 rounded-full object-cover', className)} />;
  }
  return (
    <span
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[hsl(280_70%_50%)] text-2xs font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]',
        className,
      )}
      aria-hidden
    >
      {userInitials(name, email)}
    </span>
  );
}

/**
 * The signed-in account at the foot of the sidebar: who you are, your own
 * settings, the docs and the way out, in one place instead of two loose
 * links. Also carries the control-plane version, which used to float over
 * the page's bottom-right corner.
 */
export function UserMenu({ slug }: { slug: string }) {
  const router = useRouter();
  const { user, isPlatformAdmin } = useWorkspace();
  const version = useControlVersion(process.env.NEXT_PUBLIC_APP_VERSION || 'dev-local');
  const displayName = user?.name || user?.email?.split('@')[0] || 'Mon compte';

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      router.push('/login');
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-white/[0.06]">
        <UserAvatar name={user?.name} email={user?.email} avatarUrl={user?.avatarUrl} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium leading-5 text-foreground">{displayName}</span>
          <span className="block truncate text-2xs text-muted-foreground">{user?.email ?? '…'}</span>
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[15rem]">
        <div className="flex items-center gap-2.5 px-2 py-2">
          <UserAvatar name={user?.name} email={user?.email} avatarUrl={user?.avatarUrl} className="h-9 w-9" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
            <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push(`/${slug}/dashboard/settings?section=notifications`)} className="gap-2.5">
          <BellRing className="text-muted-foreground" />
          Mes notifications
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => router.push('/workspaces')} className="gap-2.5">
          <LayoutGrid className="text-muted-foreground" />
          Mes workspaces
        </DropdownMenuItem>
        {isPlatformAdmin && (
          <DropdownMenuItem onSelect={() => router.push('/admin')} className="gap-2.5">
            <ShieldCheck className="text-muted-foreground" />
            Administration de la plateforme
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => router.push('/docs')} className="gap-2.5">
          <BookOpen className="text-muted-foreground" />
          Documentation
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void logout()} className="gap-2.5 text-[hsl(var(--danger))] focus:bg-[hsl(var(--danger))]/10 focus:text-[hsl(var(--danger))]">
          <LogOut />
          Se déconnecter
        </DropdownMenuItem>
        <p className="px-2 pb-1 pt-1.5 font-mono text-[10px] text-muted-foreground/60">Tarmac · version {version}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
