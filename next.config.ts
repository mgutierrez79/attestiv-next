import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  // Pin the Turbopack workspace root to this app. The repo lives inside a
  // multi-repo parent folder with no manifest of its own, and Turbopack's
  // root inference can land on that parent — module resolution (tailwindcss,
  // etc.) then fails in local dev.
  turbopack: {
    root: process.cwd(),
  },
}

export default nextConfig
