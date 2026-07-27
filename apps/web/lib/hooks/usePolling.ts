'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import useSWR, { type SWRConfiguration } from 'swr';

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
  const { intervalMs = 5000, redirectOnError = true, ...swrOptions } = options ?? {};

  const { data, error, mutate, isLoading, isValidating } = useSWR<T>(key, fetcher, {
    refreshInterval: intervalMs,
    revalidateOnFocus: true,
    ...swrOptions,
  });

  useEffect(() => {
    if (error && redirectOnError) router.push('/login');
  }, [error, redirectOnError, router]);

  return { data, error, mutate, isLoading, isValidating };
}
