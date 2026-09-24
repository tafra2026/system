/**
 * Plain ESM on purpose (was next.config.ts). A TypeScript config must be transpiled when
 * the server starts, which needs either Node's built-in type stripping or the native SWC
 * binary (@next/swc-linux-x64-gnu requires glibc >= 2.30). Hosts with an older glibc then
 * fail to load the config at all. A .mjs config is loaded with a plain import() and needs
 * neither. See docs/DEPLOY.ar.md ("old glibc hosts").
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  poweredByHeader: false,
  // NEXT_OUTPUT=standalone builds a self-contained server (.next/standalone) for hosts that
  // run a prebuilt app; the default Docker setup keeps the regular output.
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' } : {}),
  serverExternalPackages: ['@node-rs/argon2', 'sharp'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        // Service worker must never be served stale.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
    ]
  },
}

export default nextConfig
