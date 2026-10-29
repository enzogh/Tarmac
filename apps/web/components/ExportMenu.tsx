'use client';

import { useState } from 'react';
import { ChevronDown, Download, LoaderCircle } from 'lucide-react';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from './ui/dropdown-menu';

export type ExportFormat = 'csv' | 'json';

/**
 * "Exporter ▾" with a spreadsheet (CSV) and a JSON choice. The download
 * itself is the caller's (see api.*.download); this keeps the button busy
 * meanwhile and says so when it fails, instead of failing silently.
 */
export function ExportMenu({ onExport, hint, size = 'sm' }: { onExport: (format: ExportFormat) => Promise<void>; hint?: string; size?: 'sm' | 'default' }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (format: ExportFormat) => {
    setBusy(true);
    setError(null);
    try {
      await onExport(format);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'L’export a échoué.');
      setTimeout(() => setError(null), 6000);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex items-center gap-2">
      {error && (
        <span role="alert" className="text-xs text-[hsl(var(--danger))]">
          {error}
        </span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size={size} className="gap-1.5" disabled={busy}>
            {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Exporter
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {hint && <DropdownMenuLabel className="text-2xs font-normal text-muted-foreground">{hint}</DropdownMenuLabel>}
          <DropdownMenuItem onClick={() => void run('csv')}>Tableur (CSV)</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void run('json')}>JSON</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
