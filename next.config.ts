import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
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
