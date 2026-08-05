import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Node-env unit tests for the grafik wiring logic (date helpers + the tenant-runtime proxy).
// The UI + live round-trip need the compose stack; these cover what can be asserted in isolation.
export default defineConfig({
  test: {
    environment: 'node',
    // lib/** = grafik wiring logic; components/tour/** = pure tour data + navigation helpers
    // (the isolated guided-tour component's testable, non-React logic).
    include: ['lib/**/*.test.ts', 'components/tour/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
})
