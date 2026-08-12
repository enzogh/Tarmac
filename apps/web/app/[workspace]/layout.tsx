'use client';

import { ReactNode, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ApiError, api, getCurrentWorkspaceId, setCurrentWorkspaceId, WorkspaceListItem } from '../../lib/api';
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
    let attempt = 0;
    setReady(false);

    const resolve = () => {
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
        .catch((error: unknown) => {
          if (cancelled) return;
          // Only a real 401 means the session itself is invalid - a
          // network blip, an aborted request from fast navigation, or a
          // brief workspace-scope race isn't "logged out", so retry a
          // couple of times with backoff before giving up to /workspaces
          // (never straight to /login for those).
          if (error instanceof ApiError && error.status === 401) {
            router.replace('/login');
            return;
          }
          if (attempt < 3) {
            attempt += 1;
            setTimeout(resolve, 500 * attempt);
          } else {
            router.replace('/workspaces');
          }
        });
    };
    resolve();

    return () => {
      cancelled = true;
    };
  }, [params.workspace, router]);

  if (!ready) return null;

  return <DashboardLayout>{children}</DashboardLayout>;
}
