import { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/utils';

export interface AnimatedGradientTextProps extends ComponentPropsWithoutRef<'span'> {
  speed?: number;
  colorFrom?: string;
  colorTo?: string;
}

// Defaults match the blue/violet already used in globals.css's radial-premium
// background (rgba(37,99,235,...) -> rgba(168,85,247,...)), so the animated
// text reads as the same brand gradient instead of a new color.
export function AnimatedGradientText({
  children,
  className,
  speed = 1,
  colorFrom = '#2563eb',
  colorTo = '#a855f7',
  ...props
}: AnimatedGradientTextProps) {
  return (
    <span
      style={
        {
          '--bg-size': `${speed * 300}%`,
          '--color-from': colorFrom,
          '--color-to': colorTo,
        } as React.CSSProperties
      }
      className={cn(
        'inline animate-gradient bg-gradient-to-r from-[var(--color-from)] via-[var(--color-to)] to-[var(--color-from)] bg-[length:var(--bg-size)_100%] bg-clip-text text-transparent',
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
