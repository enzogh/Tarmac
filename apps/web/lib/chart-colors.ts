// The categorical ramp, ordered so that adjacent entries stay distinguishable
// at a 2px legend swatch and for the most common forms of colour blindness
// (hue steps of roughly 60-100°, never two adjacent greens or two blues).
// Defined once here because the storage donut, the node comparison bars and
// the topology graph all used to pick their own ad-hoc colours.
export const SERIES_VARS = [
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
  '--chart-6',
  '--chart-7',
] as const;

/** `hsl(var(--chart-n))` for the nth series, wrapping around the ramp. */
export function seriesColor(index: number): string {
  return `hsl(var(${SERIES_VARS[index % SERIES_VARS.length]}))`;
}

/** Semantic colours, for anything whose hue carries meaning rather than identity. */
export const STATUS_COLOR = {
  ok: 'hsl(var(--ok))',
  warn: 'hsl(var(--warn))',
  danger: 'hsl(var(--danger))',
  info: 'hsl(var(--info))',
  neutral: 'hsl(var(--neutral))',
} as const;
