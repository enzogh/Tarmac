'use client';

import { ReactNode, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, getCurrentWorkspaceId, setCurrentWorkspaceId, WorkspaceListItem } from '../../lib/api';
import { DashboardLayout } from '../../components/DashboardLayout';

// Resolves the `[workspace]` URL segment (slug or id, either is a valid
// link) against the caller's accessible workspaces, then keeps the
// localStorage-backed "current workspace" (read by every API call via the
// X-Workspace-Id header, see lib/api.ts) in sync with it - this is what
// makes a bookmarked or shared /acme/dashboard/infrastructure link work
// correctly even if this browser last had a different workspace selected,
// without forcing a detour through the picker first.
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ workspace: string }>();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReady(false);

    api.workspaces
      .list()
      .then((workspaces: WorkspaceListItem[]) => {
        if (cancelled) return;
        const match = workspaces.find((w) => w.slug === params.workspace || w.id === params.workspace);
        if (!match) {
          router.replace('/workspaces');
          return;
        }
        if (getCurrentWorkspaceId() !== match.id) {
          setCurrentWorkspaceId(match.id);
        }
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) router.replace('/login');
      });

    return () => {
      cancelled = true;
    };
  }, [params.workspace, router]);

  if (!ready) return null;

  return <DashboardLayout>{children}</DashboardLayout>;
}
