'use client';

import type { ReactNode } from 'react';
import { motion, type Variants } from 'framer-motion';

const variants: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: (index: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, delay: index * 0.08, ease: [0.16, 1, 0.3, 1] },
  }),
};

export function Reveal({
  children,
  index = 0,
  className,
}: {
  children: ReactNode;
  index?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-80px' }}
      custom={index}
      variants={variants}
    >
      {children}
    </motion.div>
  );
}
