'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';

type Hub = { id: string; x: number; y: number; status: 'online' | 'degraded' };

// Rough hub positions on a 1000x500 equirectangular canvas (x = (lng+180)/360*1000,
// y = (90-lat)/180*500) — enough to read as "world map" once blurred behind text,
// not meant to be geographically exact.
const HUBS: Hub[] = [
  { id: 'paris', x: 520, y: 108, status: 'online' },
  { id: 'ny', x: 255, y: 168, status: 'online' },
  { id: 'saopaulo', x: 310, y: 336, status: 'online' },
  { id: 'capetown', x: 548, y: 338, status: 'degraded' },
  { id: 'singapore', x: 728, y: 232, status: 'online' },
  { id: 'tokyo', x: 800, y: 142, status: 'online' },
  { id: 'sydney', x: 838, y: 350, status: 'online' },
];

const LINKS: Array<[string, string]> = [
  ['paris', 'ny'],
  ['ny', 'saopaulo'],
  ['paris', 'capetown'],
  ['paris', 'singapore'],
  ['singapore', 'tokyo'],
  ['singapore', 'sydney'],
];

const byId = Object.fromEntries(HUBS.map((h) => [h.id, h]));

// Rough continent silhouettes built from a handful of overlapping ellipses —
// good enough once dot-filled and blurred behind text; exact coastlines don't
// survive the blur anyway, and this avoids shipping real map tile assets.
const LANDMASSES = [
  { cx: 200, cy: 110, rx: 170, ry: 68 }, // Canada / Alaska
  { cx: 235, cy: 188, rx: 105, ry: 55 }, // US / Mexico
  { cx: 350, cy: 58, rx: 42, ry: 28 }, // Greenland
  { cx: 300, cy: 330, rx: 68, ry: 108 }, // South America (north)
  { cx: 288, cy: 420, rx: 32, ry: 42 }, // South America (south)
  { cx: 520, cy: 108, rx: 55, ry: 40 }, // Europe
  { cx: 540, cy: 205, rx: 88, ry: 68 }, // Africa (north)
  { cx: 545, cy: 315, rx: 52, ry: 68 }, // Africa (south)
  { cx: 680, cy: 128, rx: 180, ry: 88 }, // Asia (main)
  { cx: 780, cy: 88, rx: 110, ry: 55 }, // Siberia / East Asia
  { cx: 690, cy: 216, rx: 120, ry: 55 }, // South / SE Asia
  { cx: 832, cy: 338, rx: 66, ry: 38 }, // Australia
];

function insideAnyLandmass(x: number, y: number) {
  return LANDMASSES.some(({ cx, cy, rx, ry }) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1);
}

// Deterministic pseudo-jitter (no Math.random) so the server-rendered HTML
// and the client's first render produce the exact same dot positions —
// avoids a hydration mismatch.
function jitter(seed: number) {
  return Math.sin(seed * 12.9898) * 4;
}

function useWorldDots() {
  return useMemo(() => {
    const dots: Array<{ x: number; y: number }> = [];
    let seed = 0;
    for (let gx = 0; gx <= 1000; gx += 16) {
      for (let gy = 0; gy <= 500; gy += 16) {
        seed += 1;
        const x = gx + jitter(seed);
        const y = gy + jitter(seed + 100);
        if (insideAnyLandmass(x, y)) {
          dots.push({ x, y });
        }
      }
    }
    return dots;
  }, []);
}

function quadPoint(t: number, p0: readonly [number, number], c: readonly [number, number], p1: readonly [number, number]) {
  const x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t ** 2 * p1[0];
  const y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t ** 2 * p1[1];
  return [x, y] as const;
}

const STATUS_COLOR: Record<Hub['status'], string> = {
  online: '#34d399',
  degraded: '#fbbf24',
};

export function WorldConnectivityVisual({ className }: { className?: string }) {
  const dots = useWorldDots();

  return (
    <svg viewBox="0 0 1000 500" preserveAspectRatio="xMidYMid meet" className={className} aria-hidden="true" focusable="false">
      {dots.map((dot, i) => (
        <circle key={i} cx={dot.x} cy={dot.y} r={1.6} fill="rgba(196,181,253,0.6)" />
      ))}

      {LINKS.map(([fromId, toId], index) => {
        const from = byId[fromId];
        const to = byId[toId];
        const mx = (from.x + to.x) / 2;
        const my = (from.y + to.y) / 2;
        // Bow the control point away from the map's vertical center so each
        // link reads as a "flight path" arc instead of a straight ruler line.
        const bow = my < 250 ? -50 : 50;
        const control = [mx, my + bow] as const;

        const samples = 28;
        const cxs: number[] = [];
        const cys: number[] = [];
        for (let s = 0; s <= samples; s++) {
          const [x, y] = quadPoint(s / samples, [from.x, from.y], control, [to.x, to.y]);
          cxs.push(x);
          cys.push(y);
        }
        const opacitySteps = [0, ...Array(samples - 1).fill(1), 0];

        return (
          <g key={`${fromId}-${toId}`}>
            <path
              d={`M ${from.x} ${from.y} Q ${control[0]} ${control[1]} ${to.x} ${to.y}`}
              fill="none"
              stroke="rgb(139 92 246 / 0.65)"
              strokeWidth={1.5}
            />
            <motion.circle
              r={3}
              fill="#c4b5fd"
              style={{ filter: 'drop-shadow(0 0 5px rgba(196,181,253,0.9))' }}
              initial={{ cx: cxs[0], cy: cys[0], opacity: 0 }}
              animate={{ cx: cxs, cy: cys, opacity: opacitySteps }}
              transition={{ duration: 4.5, repeat: Infinity, ease: 'linear', delay: index * 0.6 }}
            />
          </g>
        );
      })}

      {HUBS.map((hub) => {
        const color = STATUS_COLOR[hub.status];
        return (
          <g key={hub.id}>
            <motion.circle
              cx={hub.x}
              cy={hub.y}
              r={10}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
              animate={{ r: [10, 22], opacity: [0.5, 0] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
            />
            <circle cx={hub.x} cy={hub.y} r={4.5} fill="rgba(9,9,11,0.9)" stroke={color} strokeWidth={2} />
            <circle cx={hub.x} cy={hub.y} r={2} fill={color} />
          </g>
        );
      })}
    </svg>
  );
}
