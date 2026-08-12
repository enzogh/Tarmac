'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';

// Fetches the backend's control-plane version (the same value the infra
// page compares each agent against) instead of the frontend's own
// independently-computed build version, so this badge and the per-agent
// "obsolète" comparison can never show two different numbers for what's
// supposed to be the same thing. Falls back to the build-time version
// (passed in from the server component) while loading or if the API is
// unreachable - e.g. on the logged-out marketing/login pages.
export function VersionBadge({ fallback }: { fallback: string }) {
  const [version, setVersion] = useState(fallback);

  useEffect(() => {
    let cancelled = false;
    api.system
      .version()
      .then((res) => {
        if (!cancelled) setVersion(res.version);
      })
      .catch(() => {
        // Keep the build-time fallback.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-50 rounded-md border border-white/10 bg-zinc-950/90 px-2.5 py-1 text-xs text-zinc-300 shadow-lg">
      Version {version}
    </div>
  );
}
