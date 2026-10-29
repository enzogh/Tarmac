'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import useSWR, { type SWRConfiguration } from 'swr';
import { ApiError, getCurrentWorkspaceId } from '../api';

// Shared polling hook: every caller using the same `key` shares one fetch,
// one cache entry and one refresh timer (SWR dedupes by key), instead of
// each page/component running its own independent setInterval against the
// same endpoint.
export function usePolling<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  options?: SWRConfiguration & { intervalMs?: number; redirectOnError?: boolean },
) {
  const router = useRouter();
  // 15 s unless a caller needs fresher data; pages also get live updates over
  // the WebSocket (useLiveSocket) for what changes often.
  const { intervalMs = 15000, redirectOnError = true, ...swrOptions } = options ?? {};

  // Every caller's plain string key (e.g. 'activity:1h') gets namespaced by
  // the currently selected workspace. Without this, switching workspaces via
  // a soft client-side navigation (not a full page reload) reuses the same
  // SWR cache entry across workspaces - combined with keepPreviousData
  // below, that means a freshly-mounted page can render the PREVIOUS
  // workspace's cached data (e.g. its charts/metrics) until the next
  // revalidation quietly overwrites it. Scoping the key makes a workspace
  // switch look like a genuinely different resource to SWR, so there's
  // nothing stale to keep showing.
  const scopedKey = key ? `${getCurrentWorkspaceId() ?? 'no-workspace'}::${key}` : null;

  const { data, error, mutate, isLoading, isValidating } = useSWR<T>(scopedKey, fetcher, {
    refreshInterval: intervalMs,
    revalidateOnFocus: true,
    // Background polls (and key changes, e.g. a re-sorted node list) keep
    // showing the last known data instead of falling back to `undefined` —
    // that's what stops `isLoading` from flipping back to true and gating
    // consumers into unmounting their chart/list behind a skeleton on every
    // refresh. Data still updates in place once the new fetch resolves.
    keepPreviousData: true,
    ...swrOptions,
  });

  useEffect(() => {
    // Only a real 401 means the session itself is invalid. Everything else
    // an error could be here - a transient network blip, a request the
    // browser aborted mid-navigation, a 403 from a workspace-scope race -
    // is not "you're logged out", and bouncing to /login on those was
    // exactly what made fast in-app navigation feel like random logouts.
    // SWR will just retry those on its own on the next poll/focus.
    const isSessionInvalid = error instanceof ApiError && error.status === 401;
    if (isSessionInvalid && redirectOnError) router.push('/login');
  }, [error, redirectOnError, router]);

  return { data, error, mutate, isLoading, isValidating };
}
