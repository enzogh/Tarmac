import { useMemo } from 'react';
import { api, NodeItem } from './api';
import { usePolling } from './hooks/usePolling';

// Labels used to live in each browser's localStorage under this key; it is
// only read once more, by the Nodes page, to move them to the API.
export const LEGACY_NODE_LABELS_STORAGE_KEY = 'tarmac_node_labels_v1';

export function labelsByNode(nodes: Array<Pick<NodeItem, 'id' | 'labels'>>): Record<string, string[]> {
  return Object.fromEntries(nodes.map((node) => [node.id, node.labels ?? []]));
}

// Shares the 'nodes' SWR entry the pages already poll, so this adds no request.
export function useNodeLabels(): Record<string, string[]> {
  const { data: nodes } = usePolling('nodes', api.nodes.list, { intervalMs: 30000 });
  return useMemo(() => labelsByNode(nodes ?? []), [nodes]);
}

export function readLegacyNodeLabels(): Record<string, string[]> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LEGACY_NODE_LABELS_STORAGE_KEY);
    return raw ? ((JSON.parse(raw) ?? {}) as Record<string, string[]>) : null;
  } catch {
    return null;
  }
}

export function clearLegacyNodeLabels(): void {
  try {
    localStorage.removeItem(LEGACY_NODE_LABELS_STORAGE_KEY);
  } catch {
    // Storage unavailable: nothing to clear.
  }
}
