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
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600/90 to-indigo-600/90 text-[11px] font-semibold text-white shadow-glow">
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
        className="mt-3 flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 transition-colors hover:border-white/[0.12] hover:bg-white/[0.05]"
      >
        <WorkspaceTile name={activeName} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-zinc-200">{activeName}</span>
          <span className="block text-[10px] text-zinc-500">Workspace actif</span>
        </span>
      </Link>
    );
  }

  return (
    <div className="mt-3">
      <Select value={currentWorkspaceId ?? undefined} onValueChange={switchWorkspace}>
        <SelectTrigger className="h-auto w-full gap-2.5 rounded-xl border-white/[0.06] bg-white/[0.02] px-2.5 py-2 hover:border-white/[0.12] hover:bg-white/[0.05] [&>span]:line-clamp-none">
          <WorkspaceTile name={activeName} />
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-xs font-medium text-zinc-200">{activeName}</span>
            <span className="block text-[10px] text-zinc-500">Changer de workspace</span>
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
