import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Shared red/amber/green thresholds for CPU/RAM/storage meters across the
// dashboard, so a saturated reading looks the same everywhere it's shown.
export const meterTone = (value: number) => {
  if (value >= 85) return { bar: 'from-rose-600 to-rose-400', text: 'text-rose-300' };
  if (value >= 65) return { bar: 'from-amber-500 to-amber-400', text: 'text-amber-300' };
  return { bar: 'from-emerald-500 to-emerald-400', text: 'text-emerald-300' };
};
