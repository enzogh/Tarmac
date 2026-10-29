import path from 'node:path';
import { fileURLToPath } from 'node:url';

const monorepoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Sent with every page. The console must never be framed by another site
// (clickjacking), browsers must not guess content types, and links out of
// the app only reveal the origin.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // A self-contained server with only the files the app uses (see the web
  // Dockerfile), traced from the monorepo root so workspace packages resolve.
  output: 'standalone',
  outputFileTracingRoot: monorepoRoot,
  experimental: {
    // These four are the app's heavy client dependencies and every one of them
    // is imported by name (`import { Server, Cpu } from 'lucide-react'`), which
    // without this pulls the whole barrel file into the route's chunk. Letting
    // Next rewrite those to per-module imports keeps each dashboard route's JS
    // to what it actually renders.
    optimizePackageImports: ['lucide-react', 'recharts', 'framer-motion', '@radix-ui/react-icons'],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
