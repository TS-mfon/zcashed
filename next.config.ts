import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  outputFileTracingIncludes: { '/api/jobs': ['./contracts/escrow.py'] },
  outputFileTracingExcludes: { '/*': ['./data/**/*', './.env*', './contracts/__pycache__/**/*'] },
  transpilePackages: ['bs58check', 'bs58', '@scure/base'],
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
}

export default nextConfig
