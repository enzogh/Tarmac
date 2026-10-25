'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

/** Copies `value` and confirms in place for two seconds. */
export function CopyButton({
  value,
  label = 'Copier',
  iconOnly = false,
  className,
}: {
  value: string;
  label?: string;
  iconOnly?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const icon = copied ? <Check className="h-3.5 w-3.5 text-[hsl(var(--ok))]" /> : <Copy className="h-3.5 w-3.5" />;
  if (iconOnly) {
    return (
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={copied ? 'Copié' : label}
        title={copied ? 'Copié' : label}
        className={cn(
          'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground',
          className,
        )}
      >
        {icon}
      </button>
    );
  }
  return (
    <Button variant="secondary" size="sm" className={cn('gap-1.5', className)} onClick={() => void copy()}>
      {icon}
      {copied ? 'Copié' : label}
    </Button>
  );
}
