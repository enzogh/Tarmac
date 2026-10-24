'use client';

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

/**
 * Two shapes, one primitive.
 *
 * `rail` (the default) is for the page-level section switcher: a full-width
 * underlined navigation sitting flush under the page header, with a sliding
 * accent bar under the active item. It reads as "where am I in this page",
 * the same way the sidebar reads as "where am I in the app" — whereas the
 * boxed pill group it replaced read as a cluster of buttons you had to
 * decode before realising it was navigation.
 *
 * `segmented` stays a compact pill group, for the genuine two-or-three-way
 * toggles that sit inside a card header next to other controls (carte/graphe,
 * 1 h/24 h/7 j, the alert status filter). Those are view options on the
 * content below them, not sections of the page, so flattening them into a
 * second rail would compete with the real one.
 */
type TabsVariant = 'rail' | 'segmented';

const TabsVariantContext = React.createContext<TabsVariant>('rail');

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { variant?: TabsVariant }
>(({ className, variant = 'rail', ...props }, ref) => (
  <TabsVariantContext.Provider value={variant}>
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        variant === 'rail'
          ? // The hairline is the list's own bottom border so the active
            // indicator can sit exactly on top of it (-bottom-px below),
            // continuing the line instead of floating above it.
            // `overflow-x: auto` makes the overflow-y axis auto too, which
            // was enough to park a vertical scrollbar at the end of the rail;
            // the horizontal scroll is a narrow-viewport fallback nobody
            // should see a chrome for, so both bars are hidden.
            'relative flex w-full items-center gap-6 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
          : 'inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5',
        className,
      )}
      {...props}
    />
  </TabsVariantContext.Provider>
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, children, ...props }, ref) => {
  const variant = React.useContext(TabsVariantContext);

  if (variant === 'segmented') {
    return (
      <TabsPrimitive.Trigger
        ref={ref}
        className={cn(
          'inline-flex items-center gap-1.5 whitespace-nowrap rounded-[7px] px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-surface-3 data-[state=active]:text-foreground data-[state=active]:shadow-sm',
          className,
        )}
        {...props}
      >
        {children}
      </TabsPrimitive.Trigger>
    );
  }

  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        'group relative -mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-0.5 pb-2.5 pt-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 data-[state=active]:border-primary data-[state=active]:text-foreground',
        // Icons inside the trigger pick up the accent only once active, so
        // the row reads as one quiet line with a single lit item.
        '[&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:shrink-0 [&>svg]:text-muted-foreground/70 [&>svg]:transition-colors data-[state=active]:[&>svg]:text-primary',
        className,
      )}
      {...props}
    >
      {children}
    </TabsPrimitive.Trigger>
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn('mt-4 space-y-4 animate-fade-in focus:outline-none', className)}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

/**
 * A count that belongs to a rail item ("En cours 3"). Parenthesised numbers
 * inside the label made the rail read as prose; a pill keeps the item's name
 * the thing you scan and the figure the thing you glance at.
 */
function TabsCount({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'tabular rounded-full bg-surface-3 px-1.5 py-px text-2xs font-semibold text-muted-foreground transition-colors group-data-[state=active]:bg-primary/15 group-data-[state=active]:text-primary',
        className,
      )}
    >
      {children}
    </span>
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, TabsCount };
