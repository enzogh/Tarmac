'use client';

import { ReactNode, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

export type SelectableItem = {
  id: string;
  label: string;
  /** Second line (IP, description…), searched too. */
  detail?: string | null;
  /** Leading visual (flag, status dot). */
  icon?: ReactNode;
  /** Small chips after the label, searched too. */
  tags?: string[];
  disabledReason?: string | null;
};

/**
 * Searchable checkbox list for picking many items out of hundreds: search
 * across label/detail/tags, select or clear everything visible at once, and
 * narrow to the current selection to review it.
 */
export function SelectableList({
  items,
  selected,
  onChange,
  placeholder = 'Rechercher…',
  emptyLabel = 'Aucun élément.',
  className,
  listClassName = 'max-h-64',
}: {
  items: SelectableItem[];
  selected: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  emptyLabel?: string;
  className?: string;
  listClassName?: string;
}) {
  const [query, setQuery] = useState('');
  const [onlySelected, setOnlySelected] = useState(false);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (onlySelected && !selectedSet.has(item.id)) return false;
      if (!needle) return true;
      return [item.label, item.detail, ...(item.tags ?? [])]
        .filter(Boolean)
        .some((value) => (value as string).toLowerCase().includes(needle));
    });
  }, [items, query, onlySelected, selectedSet]);

  const selectable = visible.filter((item) => !item.disabledReason);
  const allVisibleSelected = selectable.length > 0 && selectable.every((item) => selectedSet.has(item.id));

  const toggle = (id: string) => {
    onChange(selectedSet.has(id) ? selected.filter((value) => value !== id) : [...selected, id]);
  };
  const toggleVisible = () => {
    if (allVisibleSelected) {
      const visibleIds = new Set(selectable.map((item) => item.id));
      onChange(selected.filter((id) => !visibleIds.has(id)));
    } else {
      onChange([...new Set([...selected, ...selectable.map((item) => item.id)])]);
    }
  };

  return (
    <div className={cn('overflow-hidden rounded-lg border border-border bg-surface-2/50', className)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-2.5 py-2">
        <div className="relative min-w-[10rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={placeholder}
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <button
          type="button"
          onClick={() => setOnlySelected((value) => !value)}
          aria-pressed={onlySelected}
          className={cn(
            'h-8 rounded-md border px-2.5 text-xs transition-colors',
            onlySelected ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
          )}
        >
          {selected.length} sélectionné{selected.length > 1 ? 's' : ''}
        </button>
      </div>
      <label className="flex cursor-pointer items-center gap-2.5 border-b border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-surface-2">
        <Checkbox
          checked={allVisibleSelected}
          indeterminate={!allVisibleSelected && selectable.some((item) => selectedSet.has(item.id))}
          onChange={toggleVisible}
          disabled={selectable.length === 0}
        />
        {allVisibleSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
        {query && ` (${selectable.length} résultat${selectable.length > 1 ? 's' : ''})`}
      </label>
      <ul className={cn('scroll-thin overflow-y-auto', listClassName)}>
        {visible.length === 0 ? (
          <li className="px-3 py-6 text-center text-xs text-muted-foreground">{query ? 'Aucun résultat.' : emptyLabel}</li>
        ) : (
          visible.map((item) => (
            <li key={item.id}>
              <label
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 text-sm',
                  item.disabledReason ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-surface-2',
                )}
                title={item.disabledReason ?? undefined}
              >
                <Checkbox
                  checked={selectedSet.has(item.id)}
                  onChange={() => toggle(item.id)}
                  disabled={Boolean(item.disabledReason)}
                />
                {item.icon}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-foreground">{item.label}</span>
                    {item.tags?.slice(0, 3).map((tag) => (
                      <span key={tag} className="shrink-0 rounded bg-surface-3 px-1.5 py-px text-2xs text-muted-foreground">
                        {tag}
                      </span>
                    ))}
                  </span>
                  {(item.disabledReason || item.detail) && (
                    <span className="block truncate font-mono text-2xs text-muted-foreground">
                      {item.disabledReason ?? item.detail}
                    </span>
                  )}
                </span>
              </label>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
