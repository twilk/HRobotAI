import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // next-auth imports 'next/server' (no .js); alias it to the actual file
      'next/server': path.resolve(__dirname, 'node_modules/next/server.js'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    css: false,
    server: {
      deps: {
        // Force next-auth through Vite transform so 'next/server' alias applies
        inline: ['next-auth', '@auth/core'],
      },
    },
  },
})
