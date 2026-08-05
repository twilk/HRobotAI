import { defineConfig, devices } from '@playwright/test'

/**
 * CI-5 — browser smoke lane.
 *
 * Deliberately NOT a full E2E suite (that is M3, see the backlog). One journey: log in, land on
 * /grafik, assert it actually rendered and that the browser console stayed clean — plus a screenshot
 * written into the Evidence Pack.
 *
 * The stack is external (docker compose / staging): Keycloak + tenant-runtime + web-kit. There is no
 * `webServer` block on purpose — spinning Next.js up here would still leave the auth + API stack
 * missing, so the lane points at whatever E2E_BASE_URL says and self-skips when nothing answers.
 */

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5601'

export default defineConfig({
  testDir: './e2e',
  // These specs share one browser + one live backend; parallel workers would fight over the session.
  workers: 1,
  fullyParallel: false,
  // A red smoke lane must mean "the app is broken", never "the run was flaky".
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: {
    baseURL,
    // Screenshots that belong to the Evidence Pack are taken explicitly in the spec; these two only
    // fire on failure, to make a red CI run diagnosable.
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  outputDir: '.playwright/test-results',
})
