'use client';

import { useEffect, useRef } from 'react';
import { animate, useInView } from 'framer-motion';

export function AnimatedCounter({
  value,
  suffix = '',
  prefix = '',
}: {
  value: number;
  suffix?: string;
  prefix?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });

  useEffect(() => {
    if (!isInView || !ref.current) return;
    const node = ref.current;
    const controls = animate(0, value, {
      duration: 1.4,
      ease: [0.16, 1, 0.3, 1],
      onUpdate(latest) {
        node.textContent = `${prefix}${Math.round(latest)}${suffix}`;
      },
    });
    return () => controls.stop();
  }, [isInView, value, suffix, prefix]);

  return (
    <span ref={ref}>
      {prefix}0{suffix}
    </span>
  );
}
