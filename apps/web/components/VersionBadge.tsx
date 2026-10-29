'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { api } from '../lib/api';

// Fetches the backend's control-plane version (the same value the infra
// page compares each agent against) instead of the frontend's own
// independently-computed build version, so this badge and the per-agent
// "obsolète" comparison can never show two different numbers for what's
// supposed to be the same thing. Falls back to the build-time version
// while loading or if the API is unreachable - e.g. on the logged-out
// marketing/login pages.
export function useControlVersion(fallback: string): string {
  const [version, setVersion] = useState(fallback);

  useEffect(() => {
    let cancelled = false;
    api.system
      .version()
      .then((res) => {
        // A null version means the control plane genuinely couldn't
        // determine its own commit (see build-info.ts) - keep the build-time
        // fallback rather than overwriting it with nothing.
        if (!cancelled && res.version) setVersion(res.version);
      })
      .catch(() => {
        // Keep the build-time fallback.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return version;
}

const DASHBOARD_PATH = /^\/[^/]+\/dashboard(\/|$)/;

export function VersionBadge({ fallback }: { fallback: string }) {
  const version = useControlVersion(fallback);
  const pathname = usePathname() ?? '';

  // Inside the console the version lives in the account menu, where it no
  // longer covers the bottom-right corner of tables and cards.
  if (DASHBOARD_PATH.test(pathname)) return null;

  return (
    <div className="pointer-events-none fixed bottom-2 right-2 z-20 select-none rounded border border-border bg-background/80 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/50">
      {version}
    </div>
  );
}
