import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/**
 * CI-5 — smoke E2E: login → /grafik renders → 0 console errors → screenshot to the Evidence Pack.
 *
 * Credentials come from the seeded demo realm (scripts/seed-keycloak-demo.mjs). MANAGER is the role
 * whose landing surface is the schedule, so it is the account this smoke drives.
 */

const USERNAME = process.env.E2E_USERNAME ?? 'manager.demo'
const PASSWORD = process.env.E2E_PASSWORD ?? 'Manager!2026'

// data/m2-evidence/ is the Evidence Pack root (repo root is five levels up from docs/design/web-kit/e2e).
const EVIDENCE_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'data', 'm2-evidence', 'screenshots')

/**
 * Console noise that is NOT an application defect. Keep this list SHORT and justified — every entry
 * is a hole in the gate, so a new entry needs a reason, not a convenience.
 */
const IGNORED_CONSOLE = [
  // Next.js dev server injects HMR/websocket chatter that does not exist in a production build.
  /\[Fast Refresh\]/i,
  /webpack-hmr/i,
  // Chromium logs a console error for a missing favicon; cosmetic, not a page failure.
  /favicon\.ico/i,
  // React DevTools nag.
  /Download the React DevTools/i,
]

function isRealError(text: string): boolean {
  return !IGNORED_CONSOLE.some((re) => re.test(text))
}

/** Attach console/pageerror collectors and return the accumulating list of genuine errors. */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (isRealError(text)) errors.push(`console.error: ${text}`)
  })
  // An uncaught exception never shows up as a console message — collect it separately or a hard
  // render crash would slip through a "0 console errors" assertion.
  page.on('pageerror', (err: Error) => {
    if (isRealError(err.message)) errors.push(`pageerror: ${err.message}`)
  })
  return errors
}

test.beforeAll(() => {
  mkdirSync(EVIDENCE_DIR, { recursive: true })
})

test('J-smoke: logowanie → /grafik renderuje się bez błędów konsoli', async ({ page, baseURL }) => {
  const errors = collectErrors(page)

  // --- 1. the login screen is served ---------------------------------------------------------
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: /Zaloguj się/i })).toBeVisible()

  // --- 2. log in with the seeded MANAGER account ---------------------------------------------
  await page.locator('input[name="login"]').fill(USERNAME)
  await page.locator('input[name="pw"]').fill(PASSWORD)
  await page.locator('button[type="submit"]').click()

  // The middleware only lets a request through with an `hrobot_token` cookie, so leaving /login at
  // all is itself proof the credential exchange succeeded.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })

  const cookies = await page.context().cookies()
  expect(
    cookies.map((c) => c.name),
    'logowanie nie ustawiło ciasteczka sesji hrobot_token',
  ).toContain('hrobot_token')

  // --- 3. /grafik actually renders (not a redirect back to /login, not an error boundary) ------
  await page.goto('/grafik', { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle')

  expect(new URL(page.url()).pathname, '/grafik odrzucił zalogowaną sesję').toBe('/grafik')

  // Something schedule-shaped must be on screen — an empty shell that returns 200 is not "renders".
  await expect(page.getByRole('heading', { name: /Grafik/i }).first()).toBeVisible()
  const dayHeaders = page.getByText(/pon|wt|śr|czw|pt|sob|nd/i)
  expect(await dayHeaders.count(), 'siatka grafiku nie wyrenderowała żadnego dnia tygodnia').toBeGreaterThan(0)

  // --- 4. evidence artifact -------------------------------------------------------------------
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, 'ci5-smoke-grafik.png'),
    fullPage: true,
  })

  // --- 5. 0 console errors --------------------------------------------------------------------
  // Asserted LAST so a genuine rendering failure surfaces as the specific assertion that broke,
  // and so the screenshot exists even on a console-only failure.
  expect(errors, `błędy konsoli na ${baseURL}/grafik:\n${errors.join('\n')}`).toEqual([])
})
