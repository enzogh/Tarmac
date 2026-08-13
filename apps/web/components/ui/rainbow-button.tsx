import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// Ported from modern-ui.org's RainbowButton, adapted to this codebase's
// asChild/Slot convention (see components/ui/button.tsx) so it can wrap a
// Next <Link> like the rest of the app's buttons. The sweep colors come from
// --color-1..5 in globals.css (blue -> violet, matching the app's palette
// instead of a literal rainbow).
const rainbowButtonVariants = cva(
  'group relative inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border-0 bg-[length:200%] font-medium text-primary-foreground transition-colors [background-clip:padding-box,border-box,border-box] [background-origin:border-box] [border:calc(0.08*1rem)_solid_transparent] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 before:absolute before:bottom-[-20%] before:left-1/2 before:z-0 before:h-1/5 before:w-3/5 before:-translate-x-1/2 before:animate-rainbow before:bg-[linear-gradient(90deg,hsl(var(--color-1)),hsl(var(--color-5)),hsl(var(--color-3)),hsl(var(--color-4)),hsl(var(--color-2)))] before:[filter:blur(calc(0.8*1rem))] bg-[linear-gradient(hsl(var(--background)),hsl(var(--background))),linear-gradient(hsl(var(--background))_50%,hsla(var(--background)/0.6)_80%,hsla(var(--background)/0)),linear-gradient(90deg,hsl(var(--color-1)),hsl(var(--color-5)),hsl(var(--color-3)),hsl(var(--color-4)),hsl(var(--color-2)))]',
  {
    variants: {
      size: {
        sm: 'h-8 px-4 text-sm',
        default: 'h-9 px-4 py-2',
        lg: 'h-11 px-8 text-base',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  },
);

export interface RainbowButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof rainbowButtonVariants> {
  asChild?: boolean;
}

const RainbowButton = React.forwardRef<HTMLButtonElement, RainbowButtonProps>(
  ({ className, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp ref={ref} className={cn(rainbowButtonVariants({ size, className }))} {...props} />;
  },
);
RainbowButton.displayName = 'RainbowButton';

export { RainbowButton, rainbowButtonVariants };
