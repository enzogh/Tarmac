import { Layers } from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * The Tarmac mark: the Layers glyph on a filled square of the app's primary
 * violet.
 *
 * It was redrawn four times - sidebar, workspace picker, public header and
 * the SSO screen - and had drifted into two different logos. The sidebar and
 * the favicon carried a flat `bg-primary` square, while the header and the
 * login screen carried a violet-to-indigo gradient with a glow ring, left
 * over from when the front page was a marketing page. Signing in therefore
 * showed one logo and landing in the console showed another.
 *
 * One component, one mark. The proportions follow the favicon so the browser
 * tab and the page agree: a corner radius of a quarter of the tile, and a
 * glyph a little under two thirds of it.
 */
const SIZES = {
  sm: { tile: 'h-6 w-6 rounded-md', glyph: 'h-3.5 w-3.5' },
  md: { tile: 'h-8 w-8 rounded-lg', glyph: 'h-[18px] w-[18px]' },
  lg: { tile: 'h-14 w-14 rounded-[14px]', glyph: 'h-8 w-8' },
} as const;

export function BrandMark({
  size = 'sm',
  className,
}: {
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const { tile, glyph } = SIZES[size];
  return (
    <span className={cn('flex shrink-0 items-center justify-center bg-primary', tile, className)}>
      <Layers className={cn('text-primary-foreground', glyph)} aria-hidden />
    </span>
  );
}
