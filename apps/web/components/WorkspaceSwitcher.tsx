'use client';

import { useRouter } from 'next/navigation';
import { Check, ChevronsUpDown, LayoutGrid } from 'lucide-react';
import { useWorkspace } from '../lib/workspace-context';
import { cn } from '../lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

// Two letters, always - a single stray capital reads as a broken image
// placeholder rather than a deliberate monogram. Multi-word names use the
// first letter of each of the first two words; a single-word name falls
// back to its own first two letters ("Intraced" -> "IN", not just "I").
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  if (words.length === 1) {
    const word = words[0];
    return word.length >= 2 ? word.slice(0, 2).toUpperCase() : (word[0] + word[0]).toUpperCase();
  }
  return '??';
}

// Each workspace keeps the same colour everywhere (sidebar, picker page), so
// people with several of them recognise which one is open at a glance.
export function workspaceHue(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index++) hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  return Math.abs(hash) % 360;
}

export function WorkspaceTile({ name, seed, className }: { name: string; seed?: string; className?: string }) {
  const hue = workspaceHue(seed ?? name);
  return (
    <span
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-2xs font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]',
        className,
      )}
      style={{ backgroundImage: `linear-gradient(135deg, hsl(${hue} 70% 52%), hsl(${(hue + 40) % 360} 65% 40%))` }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

/**
 * The open workspace, at the top of the sidebar. Always a menu, even with a
 * single workspace: it is also the way back to the full list.
 */
export function WorkspaceSwitcher() {
  const { workspaces, currentWorkspace, currentWorkspaceId, switchWorkspace, isLoading } = useWorkspace();
  const router = useRouter();

  if (isLoading || workspaces.length === 0) {
    return <div className="h-[46px] animate-pulse rounded-lg bg-surface-2/60" aria-hidden />;
  }

  const active = currentWorkspace ?? workspaces[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="group flex w-full items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5 text-left outline-none transition-colors hover:border-white/[0.1] hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:border-white/[0.12] data-[state=open]:bg-white/[0.06]">
        <WorkspaceTile name={active.name} seed={active.id} className="h-8 w-8" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium leading-5 text-foreground">{active.name}</span>
          <span className="block truncate text-2xs text-muted-foreground">
            {workspaces.length > 1 ? `${workspaces.length} workspaces` : 'Workspace'}
          </span>
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[15rem]">
        <DropdownMenuLabel className="px-2 pb-1 pt-1.5 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
          Changer de workspace
        </DropdownMenuLabel>
        <div className="max-h-72 overflow-y-auto scroll-thin">
          {workspaces.map((workspace) => {
            const isCurrent = workspace.id === currentWorkspaceId;
            return (
              <DropdownMenuItem
                key={workspace.id}
                onSelect={() => switchWorkspace(workspace.id)}
                className={cn('gap-2.5', isCurrent && 'bg-white/[0.04]')}
              >
                <WorkspaceTile name={workspace.name} seed={workspace.id} className="h-6 w-6 rounded-md text-[10px]" />
                <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                {isCurrent && <Check className="h-4 w-4 text-primary" />}
              </DropdownMenuItem>
            );
          })}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push('/workspaces')} className="gap-2.5 text-muted-foreground">
          <LayoutGrid className="h-4 w-4" />
          Tous mes workspaces
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
