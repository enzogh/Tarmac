import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-2xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
        secondary: 'border-border bg-surface-3 text-secondary-foreground',
        destructive: 'border-[hsl(var(--danger))]/25 bg-[hsl(var(--danger))]/10 text-[hsl(var(--danger))]',
        outline: 'border-border bg-surface-2 text-foreground',
        success: 'border-[hsl(var(--ok))]/25 bg-[hsl(var(--ok))]/10 text-[hsl(var(--ok))]',
        warning: 'border-[hsl(var(--warn))]/25 bg-[hsl(var(--warn))]/10 text-[hsl(var(--warn))]',
        info: 'border-[hsl(var(--info))]/25 bg-[hsl(var(--info))]/10 text-[hsl(var(--info))]',
        critical: 'border-[hsl(var(--danger))]/40 bg-[hsl(var(--danger))]/20 text-[hsl(var(--danger))]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
