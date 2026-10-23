/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // These four are the app's heavy client dependencies and every one of them
  // is imported by name (`import { Server, Cpu } from 'lucide-react'`), which
  // without this pulls the whole barrel file into the route's chunk. Letting
  // Next rewrite those to per-module imports keeps each dashboard route's JS
  // to what it actually renders.
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts', 'framer-motion', '@radix-ui/react-icons'],
  },
};

export default nextConfig;
