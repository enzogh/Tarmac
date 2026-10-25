'use client';

import { ReactNode, useEffect, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { ApiError, api, getCurrentWorkspaceId, setCurrentWorkspaceId, WorkspaceListItem } from '../../lib/api';
import { DashboardLayout } from '../../components/DashboardLayout';
import { ChartCardSkeleton, Skeleton, StatCardSkeleton } from '../../components/ui/skeleton';

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
  const pathname = usePathname();
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
          const match =
            workspaces.find((w) => w.slug === params.workspace || w.id === params.workspace) ??
            workspaces.find((w) => w.previousSlugs?.includes(params.workspace));
          if (!match) {
            router.replace('/workspaces');
            return;
          }
          // An old slug (renamed workspace) or a raw id: same page under the
          // current slug, so the address bar and every link built from it
          // stay canonical.
          if (match.slug !== params.workspace) {
            const rest = pathname.split('/').slice(2).join('/');
            router.replace(`/${match.slug}/${rest}${window.location.search}`);
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

  // The shell (sidebar, header, workspace switcher) is built entirely from
  // the URL's own `[workspace]` segment, so it can paint immediately -
  // returning null for the whole subtree until api.workspaces.list()
  // resolved meant every hard navigation into the dashboard showed a blank
  // page for a full API round-trip. Only `children` genuinely has to wait,
  // because their API calls need the X-Workspace-Id header this effect
  // sets; they get a skeleton in the content area meanwhile.
  return <DashboardLayout>{ready ? children : <PageSkeleton />}</DashboardLayout>;
}

function PageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <StatCardSkeleton key={index} />
        ))}
      </div>
      <ChartCardSkeleton />
    </div>
  );
}
