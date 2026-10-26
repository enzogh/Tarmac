'use client';

import Link from 'next/link';
import { LayoutGrid } from 'lucide-react';
import { useWorkspace } from '../lib/workspace-context';
import { Select, SelectContent, SelectItem, SelectTrigger } from './ui/select';

// Two letters, always - a single stray capital reads as a broken image
// placeholder rather than a deliberate monogram. Multi-word names use the
// first letter of each of the first two words; a single-word name falls
// back to its own first two letters ("Intraced" -> "IN", not just "I").
function initials(name: string): string {
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

function WorkspaceTile({ name }: { name: string }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-3 text-2xs font-semibold text-foreground">
      {initials(name)}
    </span>
  );
}

// Renders as a small "current workspace" identity card in the sidebar
// header, not a bare dropdown - always shows the active workspace's name
// prominently since every page is now scoped under it (/<slug>/dashboard/...).
// A single-workspace account still gets the card (just non-interactive,
// linking to the picker) so the visual weight is consistent either way.
export function WorkspaceSwitcher() {
  const { workspaces, currentWorkspace, currentWorkspaceId, switchWorkspace, isLoading } = useWorkspace();

  if (isLoading || workspaces.length === 0) {
    return null;
  }

  const activeName = currentWorkspace?.name ?? workspaces[0].name;

  if (workspaces.length === 1) {
    return (
      <Link
        href="/workspaces"
        className="mt-2 flex items-center gap-2.5 rounded-md border border-border bg-surface-2 px-2 py-1.5 transition-colors hover:bg-surface-3"
      >
        <WorkspaceTile name={activeName} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-foreground">{activeName}</span>
          <span className="block text-[10px] text-muted-foreground">Workspace actif</span>
        </span>
      </Link>
    );
  }

  return (
    <div className="mt-2">
      <Select value={currentWorkspaceId ?? undefined} onValueChange={switchWorkspace}>
        {/* line-clamp-none (unclamped name) also sets display:block on every
            direct span, which would undo the tile's flex centering. */}
        <SelectTrigger className="h-auto w-full gap-2.5 rounded-md border-border bg-surface-2 px-2 py-1.5 hover:bg-surface-3 [&>span:first-child]:flex [&>span]:line-clamp-none">
          <WorkspaceTile name={activeName} />
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-xs font-medium text-foreground">{activeName}</span>
            <span className="block text-[10px] text-muted-foreground">Changer de workspace</span>
          </span>
        </SelectTrigger>
        <SelectContent>
          {workspaces.map((workspace) => (
            <SelectItem key={workspace.id} value={workspace.id}>
              {workspace.name}
            </SelectItem>
          ))}
          {/* The sidebar no longer carries a "Mes workspaces" nav item - the
              workspace card is the way back, so the picker it opens has to
              offer the full list page too, not just a swap between the ones
              already loaded. */}
          <div className="mt-1 border-t border-border pt-1">
            <Link
              href="/workspaces"
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Mes workspaces
            </Link>
          </div>
        </SelectContent>
      </Select>
    </div>
  );
}
