'use client';

import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { AdminProfile, api, getCurrentWorkspaceId, setCurrentWorkspaceId, WorkspaceSummary } from './api';

type WorkspaceContextValue = {
  workspaces: WorkspaceSummary[];
  currentWorkspaceId: string | null;
  currentWorkspace: WorkspaceSummary | null;
  isPlatformAdmin: boolean;
  /** The signed-in account, for the user menu. Null until loaded. */
  user: Pick<AdminProfile, 'id' | 'email' | 'name' | 'avatarUrl'> | null;
  isLoading: boolean;
  // Switching workspace changes what every API call returns - since this app
  // has no shared query cache to invalidate, the simplest correct way to get
  // every open page's data back in sync is a hard navigation to the target
  // workspace's own URL (rather than reloading the current one), which also
  // keeps the address bar correct for the workspace now in view.
  switchWorkspace: (workspaceId: string) => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [currentWorkspaceId, setCurrentWorkspaceIdState] = useState<string | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [user, setUser] = useState<WorkspaceContextValue['user']>(null);
  const [isLoading, setIsLoading] = useState(true);
  // The URL is the source of truth for which workspace is open: on a deep
  // link the stored id still points at the last workspace visited until the
  // [workspace] layout catches up, and the switcher showed that one instead.
  const slug = useParams<{ workspace?: string }>()?.workspace;

  useEffect(() => {
    let cancelled = false;
    api.profile
      .get()
      .then((profile) => {
        if (cancelled) return;
        setWorkspaces(profile.workspaces);
        setIsPlatformAdmin(profile.isSuperuser);
        setUser({ id: profile.id, email: profile.email, name: profile.name, avatarUrl: profile.avatarUrl });

        const stored = getCurrentWorkspaceId();
        const fromUrl = slug ? profile.workspaces.find((w) => w.slug === slug || w.id === slug)?.id : undefined;
        const resolved =
          fromUrl ??
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
      user,
      isLoading,
      switchWorkspace: (workspaceId: string) => {
        if (workspaceId === currentWorkspaceId) return;
        setCurrentWorkspaceId(workspaceId);
        const target = workspaces.find((w) => w.id === workspaceId);
        window.location.href = target ? `/${target.slug}/dashboard` : '/workspaces';
      },
    }),
    [workspaces, currentWorkspaceId, isPlatformAdmin, user, isLoading],
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
