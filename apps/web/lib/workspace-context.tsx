'use client';

import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { api, getCurrentWorkspaceId, setCurrentWorkspaceId, WorkspaceSummary } from './api';

type WorkspaceContextValue = {
  workspaces: WorkspaceSummary[];
  currentWorkspaceId: string | null;
  currentWorkspace: WorkspaceSummary | null;
  isPlatformAdmin: boolean;
  isLoading: boolean;
  // Switching workspace changes what every API call returns - since this app
  // has no shared query cache to invalidate, the simplest correct way to get
  // every open page's data back in sync is a full reload.
  switchWorkspace: (workspaceId: string) => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [currentWorkspaceId, setCurrentWorkspaceIdState] = useState<string | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.profile
      .get()
      .then((profile) => {
        if (cancelled) return;
        setWorkspaces(profile.workspaces);
        setIsPlatformAdmin(profile.isSuperuser);

        const stored = getCurrentWorkspaceId();
        const resolved =
          (stored && profile.workspaces.some((w) => w.id === stored) ? stored : null) ??
          profile.workspaces.find((w) => w.isDefault)?.id ??
          profile.workspaces[0]?.id ??
          null;
        setCurrentWorkspaceIdState(resolved);
        setCurrentWorkspaceId(resolved);
      })
      .catch(() => {
        // Unauthenticated or API unreachable - pages that need auth already
        // redirect to /login on their own fetch failures.
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspaces,
      currentWorkspaceId,
      currentWorkspace: workspaces.find((w) => w.id === currentWorkspaceId) ?? null,
      isPlatformAdmin,
      isLoading,
      switchWorkspace: (workspaceId: string) => {
        if (workspaceId === currentWorkspaceId) return;
        setCurrentWorkspaceId(workspaceId);
        window.location.reload();
      },
    }),
    [workspaces, currentWorkspaceId, isPlatformAdmin, isLoading],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return ctx;
}
