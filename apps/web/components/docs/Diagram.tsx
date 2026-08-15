import { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * Shared vocabulary for every schema drawn in /docs, so the diagrams read as
 * part of the app rather than as loose SVG: same violet accent, same rounded
 * "panel" surfaces, same muted-on-dark type scale as the dashboard cards.
 *
 * Gradients / markers / filters live in <DiagramDefs />, rendered once per
 * document (see app/docs/layout.tsx) instead of inside every <Diagram>:
 * `url(#id)` resolves document-wide, so repeating the defs in each SVG would
 * mean duplicate ids on the same page.
 */

type Tone = 'default' | 'accent' | 'success' | 'warning' | 'danger';

const TONES: Record<Tone, { fill: string; stroke: string; title: string; sub: string; line: string; marker: string }> = {
  default: {
    fill: 'url(#dg-surface)',
    stroke: 'rgb(255 255 255 / 0.10)',
    title: 'rgb(244 244 245)',
    sub: 'rgb(161 161 170)',
    line: 'rgb(255 255 255 / 0.16)',
    marker: 'url(#dg-arrow-muted)',
  },
  accent: {
    fill: 'url(#dg-accent)',
    stroke: 'rgb(139 92 246 / 0.45)',
    title: 'rgb(245 243 255)',
    sub: 'rgb(196 181 253)',
    line: 'rgb(139 92 246 / 0.75)',
    marker: 'url(#dg-arrow-accent)',
  },
  success: {
    fill: 'url(#dg-success)',
    stroke: 'rgb(16 185 129 / 0.40)',
    title: 'rgb(236 253 245)',
    sub: 'rgb(110 231 183)',
    line: 'rgb(16 185 129 / 0.65)',
    marker: 'url(#dg-arrow-success)',
  },
  warning: {
    fill: 'url(#dg-warning)',
    stroke: 'rgb(245 158 11 / 0.40)',
    title: 'rgb(255 251 235)',
    sub: 'rgb(252 211 77)',
    line: 'rgb(245 158 11 / 0.65)',
    marker: 'url(#dg-arrow-warning)',
  },
  danger: {
    fill: 'url(#dg-danger)',
    stroke: 'rgb(244 63 94 / 0.35)',
    title: 'rgb(255 241 242)',
    sub: 'rgb(253 164 175)',
    line: 'rgb(244 63 94 / 0.6)',
    marker: 'url(#dg-arrow-danger)',
  },
};

export function DiagramDefs() {
  return (
    <svg aria-hidden className="pointer-events-none absolute h-0 w-0" focusable="false">
      <defs>
        <linearGradient id="dg-surface" x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="rgb(255 255 255)" stopOpacity="0.06" />
          <stop offset="100%" stopColor="rgb(255 255 255)" stopOpacity="0.015" />
        </linearGradient>
        <linearGradient id="dg-accent" x1="0" y1="0" x2="0.7" y2="1">
          <stop offset="0%" stopColor="rgb(139 92 246)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="rgb(79 70 229)" stopOpacity="0.08" />
        </linearGradient>
        <linearGradient id="dg-success" x1="0" y1="0" x2="0.7" y2="1">
          <stop offset="0%" stopColor="rgb(16 185 129)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="rgb(5 150 105)" stopOpacity="0.06" />
        </linearGradient>
        <linearGradient id="dg-warning" x1="0" y1="0" x2="0.7" y2="1">
          <stop offset="0%" stopColor="rgb(245 158 11)" stopOpacity="0.20" />
          <stop offset="100%" stopColor="rgb(217 119 6)" stopOpacity="0.05" />
        </linearGradient>
        <linearGradient id="dg-danger" x1="0" y1="0" x2="0.7" y2="1">
          <stop offset="0%" stopColor="rgb(244 63 94)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="rgb(190 18 60)" stopOpacity="0.05" />
        </linearGradient>

        {/* Soft halo behind accent boxes, echoing shadow-glow on the panels. */}
        <filter id="dg-glow" x="-30%" y="-60%" width="160%" height="220%">
          <feGaussianBlur stdDeviation="7" result="blur" />
          <feColorMatrix
            in="blur"
            type="matrix"
            values="0 0 0 0 0.545  0 0 0 0 0.361  0 0 0 0 0.965  0 0 0 0.45 0"
            result="glow"
          />
          <feMerge>
            <feMergeNode in="glow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {(
          [
            ['dg-arrow-muted', 'rgb(255 255 255 / 0.3)'],
            ['dg-arrow-accent', 'rgb(139 92 246 / 0.85)'],
            ['dg-arrow-success', 'rgb(16 185 129 / 0.8)'],
            ['dg-arrow-warning', 'rgb(245 158 11 / 0.8)'],
            ['dg-arrow-danger', 'rgb(244 63 94 / 0.75)'],
          ] as const
        ).map(([id, color]) => (
          <marker key={id} id={id} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

export function Diagram({
  viewBox,
  label,
  className,
  children,
}: {
  viewBox: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <svg viewBox={viewBox} className={cn('w-full', className)} role="img" aria-label={label}>
      {children}
    </svg>
  );
}

/** Rounded surface with a title and up to two sub-lines — the diagram's "card". */
export function DBox({
  x,
  y,
  w,
  h,
  title,
  sub,
  badge,
  tone = 'default',
  glow,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub?: string | string[];
  badge?: string;
  tone?: Tone;
  glow?: boolean;
}) {
  const t = TONES[tone];
  const subs = sub == null ? [] : Array.isArray(sub) ? sub : [sub];
  const cx = x + w / 2;
  // Title sits above the sub-lines as a block, vertically centred as a whole.
  const blockHeight = 15 + subs.length * 14 + (badge ? 16 : 0);
  let cursor = y + (h - blockHeight) / 2 + 12;

  return (
    <g filter={glow ? 'url(#dg-glow)' : undefined}>
      <rect x={x} y={y} width={w} height={h} rx={14} fill={t.fill} stroke={t.stroke} />
      <text x={cx} y={cursor} textAnchor="middle" fill={t.title} fontSize="13" fontWeight="600">
        {title}
      </text>
      {subs.map((line) => {
        cursor += 14;
        return (
          <text key={line} x={cx} y={cursor} textAnchor="middle" fill={t.sub} fontSize="10.5">
            {line}
          </text>
        );
      })}
      {badge && (
        <>
          <rect x={cx - badge.length * 3.1 - 7} y={cursor + 6} width={badge.length * 6.2 + 14} height={16} rx={8} fill="rgb(139 92 246 / 0.18)" stroke="rgb(139 92 246 / 0.4)" />
          <text x={cx} y={cursor + 17} textAnchor="middle" fill="rgb(216 205 255)" fontSize="9" fontWeight="600" letterSpacing="0.4">
            {badge}
          </text>
        </>
      )}
    </g>
  );
}

/** Connector between two boxes. `flow` animates the dash, for "traffic" links. */
export function DLink({
  x1,
  y1,
  x2,
  y2,
  label,
  sublabel,
  tone = 'accent',
  dashed,
  flow,
  arrow = 'end',
  labelDy = -8,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
  sublabel?: string;
  tone?: Tone;
  dashed?: boolean;
  flow?: boolean;
  arrow?: 'end' | 'both' | 'none';
  labelDy?: number;
}) {
  const t = TONES[tone];
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={t.line}
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={flow ? '7 7' : dashed ? '5 5' : undefined}
        markerEnd={arrow === 'none' ? undefined : t.marker}
        markerStart={arrow === 'both' ? t.marker : undefined}
      >
        {flow && <animate attributeName="stroke-dashoffset" values="28;0" dur="1.4s" repeatCount="indefinite" />}
      </line>
      {label && (
        <text x={mx} y={my + labelDy} textAnchor="middle" fill={t.sub} fontSize="10.5" fontWeight="500">
          {label}
        </text>
      )}
      {sublabel && (
        <text x={mx} y={my + labelDy + 13} textAnchor="middle" fill="rgb(113 113 122)" fontSize="9.5">
          {sublabel}
        </text>
      )}
    </g>
  );
}

/** Dashed container used to fence a region, a workspace, or a trust boundary. */
export function DFrame({
  x,
  y,
  w,
  h,
  label,
  tone = 'default',
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  tone?: Tone;
}) {
  const t = TONES[tone];
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={16} fill="rgb(255 255 255 / 0.012)" stroke={t.stroke} strokeDasharray="4 5" />
      {label && (
        <text x={x + 16} y={y + 19} fill={t.sub} fontSize="10" fontWeight="600" letterSpacing="1.4">
          {label.toUpperCase()}
        </text>
      )}
    </g>
  );
}

/** Free-standing caption inside a diagram (step numbers, side notes). */
export function DNote({
  x,
  y,
  children,
  anchor = 'middle',
  tone = 'default',
}: {
  x: number;
  y: number;
  children: string;
  anchor?: 'start' | 'middle' | 'end';
  tone?: Tone;
}) {
  return (
    <text x={x} y={y} textAnchor={anchor} fill={TONES[tone].sub} fontSize="10" fontWeight="500">
      {children}
    </text>
  );
}
