import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { readOnlyMessage, useReadOnly } from '@/lib/read-only';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[background-color,color,border-color,box-shadow,transform] duration-200 active:scale-[0.97] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-[0_1px_0_0_rgba(255,255,255,0.12)_inset] hover:bg-primary/90 hover:shadow-[0_0_0_1px_hsl(var(--primary)/0.4),0_6px_20px_-6px_hsl(var(--primary)/0.6)]',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline:
          'border border-border bg-surface-2 text-foreground hover:bg-surface-3',
        secondary:
          'border border-border bg-surface-2 text-foreground hover:bg-surface-3',
        ghost:
          'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-8 px-3',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-11 rounded-lg px-8',
        icon: 'h-8 w-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /**
   * The button creates, changes or deletes something. On a page the member
   * can only read, it stays visible (people see what exists) but locked,
   * with a padlock and a tooltip saying why.
   */
  write?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, write, ...props }, ref) => {
    const { readOnly, area } = useReadOnly();
    if (write && readOnly && !asChild) {
      const { children, onClick: _onClick, disabled: _disabled, title: _title, ...rest } = props;
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              ref={ref}
              {...rest}
              type="button"
              aria-disabled
              aria-label={typeof rest['aria-label'] === 'string' ? `${rest['aria-label']} (lecture seule)` : undefined}
              onClick={(event) => event.preventDefault()}
              className={cn(
                buttonVariants({ variant, size, className }),
                'cursor-not-allowed opacity-50 saturate-50 hover:bg-[unset] hover:text-[unset] hover:opacity-60',
              )}
            >
              {size === 'icon' ? <Lock /> : (
                <>
                  {children}
                  <Lock className="!size-3 opacity-80" />
                </>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{readOnlyMessage(area)}</TooltipContent>
        </Tooltip>
      );
    }
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
