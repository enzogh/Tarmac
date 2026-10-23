'use client';

import Link from 'next/link';
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
        <SelectTrigger className="h-auto w-full gap-2.5 rounded-md border-border bg-surface-2 px-2 py-1.5 hover:bg-surface-3 [&>span]:line-clamp-none">
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
        </SelectContent>
      </Select>
    </div>
  );
}
