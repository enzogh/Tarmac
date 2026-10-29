import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Cards carry their weight with a border and a one-step surface lift, not
 * with blur and a drop shadow. At the densities this dashboard runs at,
 * twelve blurred panels on a page cost real paint time and read as haze.
 */
const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('relative rounded-xl border border-border bg-surface-1 transition-[border-color] duration-300', className)}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

/**
 * Header and content share a 16px gutter (20px from `lg`), down from a flat
 * 24px: the old padding meant a card holding four rows of text spent more
 * pixels on its own margins than on the data.
 */
const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3 lg:px-5',
        className,
      )}
      {...props}
    />
  ),
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground', className)}
      {...props}
    />
  ),
);
CardTitle.displayName = 'CardTitle';

/**
 * `basis-full` is what lets CardHeader be a single wrapping flex row and
 * still lay out correctly in all three shapes the app uses it in: title
 * alone, title + action (side by side), and title + description + action
 * (action beside the title, description on its own line underneath).
 */
const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('basis-full text-xs text-muted-foreground', className)} {...props} />
  ),
);
CardDescription.displayName = 'CardDescription';

/**
 * `flush` is how a card hands its gutter to its content - a full-bleed list,
 * a table, a map - rather than `className="p-0"`.
 *
 * That override silently did not work: tailwind-merge scopes conflicts per
 * breakpoint, so an unprefixed `p-0` drops `px-4 py-4` and leaves `lg:px-5`
 * standing. Every flush list in the app therefore kept 20px of side padding
 * from `lg` up, on top of the padding its own rows already carry - which is
 * why their `divide-y` separators stopped short of the card's border on both
 * sides while the border itself did not. A prop sidesteps the merge entirely.
 */
const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { flush?: boolean }
>(({ className, flush = false, ...props }, ref) => (
  <div ref={ref} className={cn(!flush && 'px-4 py-4 lg:px-5', className)} {...props} />
));
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-center gap-2 border-t border-border px-4 py-3 lg:px-5', className)}
      {...props}
    />
  ),
);
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
