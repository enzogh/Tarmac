'use client';

import { useRef, useState } from 'react';

// Shared collapse/expand state for group/zone cards. Not lifted into
// useDnsPageState - unlike the Journal panel (which must be shared because a
// group's primary member and its zone can point at the same nodeId),
// collapse state has no cross-section dependency.
//
// Default rule, seeded once per data load (not recomputed on every 15s poll,
// so it never fights a manual toggle): few cards (<=3) start expanded,
// matching today's always-expanded behavior. Past that, cards collapse by
// default EXCEPT any that `forceExpand` flags - a problem should never be
// hidden by default on a live infra tool.
export function useCollapsibleCards<T extends { id: string }>(
  items: T[],
  forceExpand: (item: T) => boolean,
) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const seeded = useRef(false);

  if (!seeded.current && items.length > 0) {
    seeded.current = true;
    if (items.length > 3) {
      setCollapsed(new Set(items.filter((item) => !forceExpand(item)).map((item) => item.id)));
    }
  }

  const isCollapsed = (id: string) => collapsed.has(id);
  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return { isCollapsed, toggle };
}
