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
      className={cn('relative rounded-xl border border-border bg-surface-1', className)}
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

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('px-4 py-4 lg:px-5', className)} {...props} />
  ),
);
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
