import { ReactNode } from 'react';
import { Info, CheckCircle2, AlertTriangle, AlertCircle, LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';

type CalloutVariant = 'info' | 'success' | 'warning' | 'danger';

const VARIANTS: Record<CalloutVariant, { border: string; bg: string; text: string; icon: LucideIcon; iconColor: string }> = {
  info: {
    border: 'border-violet-500/20',
    bg: 'bg-violet-500/[0.07]',
    text: 'text-violet-200/90',
    icon: Info,
    iconColor: 'text-primary',
  },
  success: {
    border: 'border-emerald-500/20',
    bg: 'bg-emerald-500/[0.07]',
    text: 'text-emerald-200/90',
    icon: CheckCircle2,
    iconColor: 'text-emerald-300',
  },
  warning: {
    border: 'border-amber-500/20',
    bg: 'bg-amber-500/[0.07]',
    text: 'text-amber-200/90',
    icon: AlertTriangle,
    iconColor: 'text-amber-300',
  },
  danger: {
    border: 'border-rose-500/20',
    bg: 'bg-rose-500/[0.07]',
    text: 'text-rose-200/90',
    icon: AlertCircle,
    iconColor: 'text-rose-300',
  },
};

interface CalloutProps {
  variant?: CalloutVariant;
  className?: string;
  children: ReactNode;
}

export function Callout({ variant = 'info', className, children }: CalloutProps) {
  const v = VARIANTS[variant];
  const Icon = v.icon;
  return (
    <div className={cn('flex items-start gap-3 rounded-2xl border p-4', v.border, v.bg, className)}>
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', v.iconColor)} />
      <div className={cn('text-sm', v.text)}>{children}</div>
    </div>
  );
}
