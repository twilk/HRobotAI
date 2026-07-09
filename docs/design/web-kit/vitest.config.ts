import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Node-env unit tests for the grafik wiring logic (date helpers + the tenant-runtime proxy).
// The UI + live round-trip need the compose stack; these cover what can be asserted in isolation.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
})
