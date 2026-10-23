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

  // Pinned to the corner at z-50, this sat on top of whatever the page had
  // in its bottom-right - on the overview, the last row of the alerts card.
  // It stays available but out of the way: dimmed until hovered, and small
  // enough not to read as content.
  return (
    <div className="pointer-events-none fixed bottom-2 right-2 z-20 select-none rounded border border-border bg-background/80 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/50 transition-opacity hover:opacity-100">
      {version}
    </div>
  );
}
