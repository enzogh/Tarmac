export const NODE_LABELS_STORAGE_KEY = 'tarmac_node_labels_v1';

export function readNodeLabels(): Record<string, string[]> {
  if (typeof window === 'undefined') return {};
  try {
    return (JSON.parse(localStorage.getItem(NODE_LABELS_STORAGE_KEY) ?? '{}') ?? {}) as Record<string, string[]>;
  } catch {
    return {};
  }
}

export function writeNodeLabels(value: Record<string, string[]>): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(NODE_LABELS_STORAGE_KEY, JSON.stringify(value));
}
