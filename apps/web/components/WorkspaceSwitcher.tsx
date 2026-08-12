'use client';

import { Building2 } from 'lucide-react';
import { useWorkspace } from '../lib/workspace-context';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

// Renders as a plain label for the common case (exactly one accessible
// workspace) so nothing changes visually for most users - a real dropdown
// only appears once there's something to switch between (platform admins,
// or a future non-admin member of more than one workspace).
export function WorkspaceSwitcher() {
  const { workspaces, currentWorkspace, currentWorkspaceId, switchWorkspace, isLoading } = useWorkspace();

  if (isLoading || workspaces.length === 0) {
    return null;
  }

  if (workspaces.length === 1) {
    return (
      <div className="mt-3 flex items-center gap-1.5 text-[11px] text-zinc-500">
        <Building2 className="h-3 w-3" />
        <span className="truncate">{currentWorkspace?.name ?? workspaces[0].name}</span>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <Select value={currentWorkspaceId ?? undefined} onValueChange={switchWorkspace}>
        <SelectTrigger className="h-8 gap-1.5 border-white/[0.06] bg-white/[0.03] px-2.5 text-xs">
          <Building2 className="h-3 w-3 shrink-0 text-zinc-500" />
          <SelectValue placeholder="Workspace" />
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
