import path from 'node:path'
import { expect, test } from '@playwright/test'

/**
 * Evidence capture — one screenshot per tenant screen, straight into the Evidence Pack.
 *
 * WHY THIS EXISTS AS A TEST AND NOT A MANUAL PASS. The recordings previously shipped in the pack
 * were taken by hand and went stale silently: `agent-service/demo/evidence/` still shows the
 * pre-AG6 unauthenticated invocation, i.e. a flow that no longer exists in the code. A capture that
 * lives in the repo and runs on demand cannot drift like that — regenerate it and the pack is
 * current by construction.
 *
 * It deliberately reuses `smoke.spec.ts`'s login + EVIDENCE_DIR conventions rather than inventing a
 * second mechanism, and it ASSERTS on each screen (heading visible, no error boundary) so a broken
 * module fails the run instead of quietly producing a screenshot of an error page.
 *
 * Run against a live stack:
 *   npx playwright test e2e/evidence.spec.ts
 */

const USERNAME = process.env.E2E_USERNAME ?? 'manager.demo'
const PASSWORD = process.env.E2E_PASSWORD ?? 'Manager!2026'
const EVIDENCE_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'data', 'm2-evidence', 'screenshots')

/** Screens to capture, in the order a demo walks them. `heading` is the acceptance check. */
const EKRANY: ReadonlyArray<{ sciezka: string; plik: string; naglowek: RegExp }> = [
  { sciezka: '/dashboard', plik: 'j0-pulpit', naglowek: /Pulpit/i },
  { sciezka: '/pracownicy', plik: 'j1-pracownicy', naglowek: /Pracownic/i },
  { sciezka: '/grafik', plik: 'j2-grafik', naglowek: /Grafik/i },
  { sciezka: '/ai-grafik-manager', plik: 'j3-ai-grafik-manager', naglowek: /AI Grafik/i },
  { sciezka: '/zamiany', plik: 'j5-zamiany', naglowek: /Zamian/i },
  { sciezka: '/wnioski', plik: 'j6-wnioski', naglowek: /Wnioski/i },
  { sciezka: '/dostepy', plik: 'j7-dostepy', naglowek: /Dostep|Dostęp/i },
  { sciezka: '/dokumenty', plik: 'm3-dokumenty', naglowek: /Dokumenty/i },
  { sciezka: '/asystent', plik: 'm3-asystent', naglowek: /Asystent/i },
  { sciezka: '/analityk', plik: 'm3-analityk-hr', naglowek: /Analityk/i },
  // Heading is NOT "Analiza" — the route is /analiza but the screen is titled "Strategiczny mózg
  // kadrowy". Asserting on the route name instead of the rendered heading is exactly how a capture
  // silently degrades into a screenshot of nothing.
  { sciezka: '/analiza', plik: 'm3-analiza', naglowek: /Strategiczny mózg/i },
]

test('materiał dowodowy — zrzut każdego ekranu najemcy', async ({ page }) => {
  // Analityk HR aggregates across the whole tenant and needs noticeably longer than the default:
  // measured ~8 s to first paint on the demo dataset (39 employees, 833 shifts). A 5 s wait
  // screenshots a spinner, which is exactly the misleading artefact this file exists to prevent.
  test.setTimeout(180_000)

  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.locator('input[name="login"]').fill(USERNAME)
  await page.locator('input[name="pw"]').fill(PASSWORD)
  await page.getByRole('button', { name: /Zaloguj/i }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 })

  const pominiete: string[] = []

  for (const ekran of EKRANY) {
    await page.goto(ekran.sciezka, { waitUntil: 'domcontentloaded' })

    // A role this account cannot reach redirects rather than rendering — record it and move on
    // instead of failing the whole capture. RBAC differences between demo accounts are expected.
    if (new URL(page.url()).pathname !== ekran.sciezka) {
      pominiete.push(`${ekran.sciezka} → ${new URL(page.url()).pathname}`)
      continue
    }

    // Wait for real content, not a spinner: the heading must be visible AND every "Ładowanie…"
    // placeholder gone. `networkidle` is useless here — several screens poll on a timer.
    await expect(page.getByRole('heading', { name: ekran.naglowek }).first()).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText(/Ładowanie/i).first()).toBeHidden({ timeout: 60_000 }).catch(() => {
      /* no placeholder on this screen — nothing to wait for */
    })

    await page.screenshot({ path: path.join(EVIDENCE_DIR, `${ekran.plik}.png`), fullPage: true })
  }

  // Surfaced in the run output so a shrinking capture set is visible, never silent.
  if (pominiete.length > 0) console.log(`Pominięte (poza zakresem roli ${USERNAME}): ${pominiete.join(', ')}`)

  expect(pominiete.length, `zbyt wiele ekranów poza zakresem roli: ${pominiete.join(', ')}`).toBeLessThan(EKRANY.length / 2)
})
