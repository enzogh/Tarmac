import * as React from 'react';
import { cn } from '../../lib/utils';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-lg bg-white/[0.06] bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.09),transparent)] bg-[length:200%_100%] animate-shimmer',
        className,
      )}
      {...props}
    />
  );
}

// Same box as <Stat> (rounded-xl, p-4, label row, 1.75rem figure, hint) so
// the row doesn't jump when the real tiles replace it.
export function StatCardSkeleton() {
  return (
    <div className="flex min-w-0 flex-col justify-between gap-3 rounded-xl border border-border bg-surface-1 p-4">
      <div className="flex items-start justify-between gap-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-4 w-4 rounded" />
      </div>
      <div>
        <Skeleton className="h-7 w-16" />
        <Skeleton className="mt-1.5 h-3 w-28" />
      </div>
    </div>
  );
}

export function ChartCardSkeleton({ height = 'h-64' }: { height?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-1 p-6">
      <div className="mb-4 flex items-center gap-2">
        <Skeleton className="h-5 w-5 rounded" />
        <Skeleton className="h-4 w-40" />
      </div>
      <Skeleton className={cn('w-full', height)} />
    </div>
  );
}

export function ListRowSkeleton() {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-3.5 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
      <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
    </div>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, index) => (
        <ListRowSkeleton key={index} />
      ))}
    </div>
  );
}

export function TableRowSkeleton({ columns = 4 }: { columns?: number }) {
  return (
    <tr className="border-b border-border">
      {Array.from({ length: columns }).map((_, index) => (
        <td key={index} className="px-4 py-3">
          <Skeleton className="h-3.5 w-full max-w-[10rem]" />
        </td>
      ))}
    </tr>
  );
}

export function CardListSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {Array.from({ length: cards }).map((_, index) => (
        <div key={index} className="rounded-2xl border border-border bg-surface-1 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
          <Skeleton className="h-16 w-full" />
          <div className="flex gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Rows shaped like the Nodes table: checkbox, name over address, status, meters. */
export function NodesTableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border">
      <div className="flex items-center gap-4 px-4 py-2.5">
        <Skeleton className="h-3.5 w-3.5 rounded" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="ml-auto hidden h-3 w-48 md:block" />
      </div>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-4 px-4 py-3">
          <Skeleton className="h-3.5 w-3.5 shrink-0 rounded" />
          <div className="min-w-0 flex-1 space-y-1.5 sm:max-w-[16rem]">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="hidden h-5 w-16 rounded-md sm:block" />
          <Skeleton className="hidden h-1.5 w-20 rounded-full md:block" />
          <Skeleton className="hidden h-1.5 w-20 rounded-full md:block" />
          <Skeleton className="hidden h-1.5 w-20 rounded-full lg:block" />
          <Skeleton className="ml-auto h-6 w-6 rounded-md" />
        </div>
      ))}
    </div>
  );
}

/** One-line status banner (internal DNS card and similar). */
export function BannerSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-1 px-4 py-3">
      <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-56" />
        <Skeleton className="h-3 w-80 max-w-full" />
      </div>
    </div>
  );
}
