import { expect, test } from '@playwright/test'

/**
 * Moduły rozliczane w KM3 MUSZĄ być osiągalne z menu — dla każdej roli, która ma je widzieć.
 *
 * DLACZEGO TEN PLIK ISTNIEJE. Do 2026-08-10 ekran `/analiza` („Strategiczny mózg kadrowy”, backend
 * `strategic-brain`) NIE MIAŁ pozycji w nawigacji, mimo że to on jest modułem opisanym w KM3 §3.2
 * jako „Analityk HR” (kryteria AN-1..AN-13, 134 testy). Był osiągalny wyłącznie przez ręczne wpisanie
 * adresu, a mylnie podobna pozycja „Analityk HR” w menu prowadzi do INNEGO ekranu — operacyjnego
 * pulpitu KPI. Nikt tego nie zauważył, bo żaden test nie pytał „czy da się tam kliknąć”: testy
 * jednostkowe sprawdzały logikę modułu, a `evidence.spec.ts` wchodził na trasy po URL-u, nie z menu.
 *
 * Ten spec pyta dokładnie o to, czego brakowało: czy pozycja jest w menu, czy klik prowadzi na ekran
 * i czy ekran renderuje treść zamiast błędu — osobno dla każdej roli.
 *
 * Uruchomienie:  E2E_BASE_URL=http://localhost:8080 npx playwright test e2e/km3-modules-reachable.spec.ts
 */

const KONTA = [
  { login: 'demo', pw: 'demo-staging-2026', rola: 'ADMIN_KLIENTA' },
  { login: 'manager.demo', pw: 'Manager!2026', rola: 'MANAGER' },
  { login: 'pracownik.demo', pw: 'Pracownik!2026', rola: 'PRACOWNIK' },
] as const

/** Komunikaty, których obecność oznacza, że ekran się NIE wyrenderował. */
const BLAD_RE = /Nie udało się|Brak połączenia|Brak dostępu|Coś poszło nie tak/i

test('KM3 „Analityk HR” (/analiza) jest w menu i działa dla każdej roli', async ({ page }) => {
  test.setTimeout(300_000)

  for (const konto of KONTA) {
    await page.context().clearCookies()
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await page.locator('input[name="login"]').fill(konto.login)
    await page.locator('input[name="pw"]').fill(konto.pw)
    await page.getByRole('button', { name: /Zaloguj/i }).click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })

    // 1. Pozycja MUSI być w menu — to jest cała istota tego testu. Wejście po URL-u nie liczy się,
    //    bo dokładnie tak moduł „działał” wtedy, gdy był praktycznie niewidoczny.
    const pozycja = page.locator('a[href="/analiza"]')
    await expect(pozycja, `${konto.rola} nie widzi pozycji „Analiza rozwoju” w nawigacji`).toHaveCount(1)

    // 2. Klik prowadzi na ekran modułu.
    await pozycja.click()
    await page.waitForURL(/\/analiza/, { timeout: 20_000 })
    await expect(page.getByRole('heading', { name: /Strategiczny mózg/i }).first()).toBeVisible({ timeout: 60_000 })

    // 3. Ekran renderuje TREŚĆ, nie błąd. Moduł agreguje po całym najemcy i potrzebuje ~8 s na
    //    pierwszy render (zmierzone), więc krótsze czekanie łapie spinner i daje fałszywy zielony.
    await page.waitForTimeout(9_000)
    const tresc = await page.locator('main').innerText()
    expect(BLAD_RE.test(tresc), `${konto.rola} widzi komunikat błędu na /analiza`).toBe(false)
    expect(tresc.length, `${konto.rola} widzi pustą stronę`).toBeGreaterThan(200)
  }
})

test('PRACOWNIK widzi na /analiza WYŁĄCZNIE własną kartę — nigdy cudzych nazwisk', async ({ page }) => {
  test.setTimeout(180_000)

  await page.context().clearCookies()
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.locator('input[name="login"]').fill('pracownik.demo')
  await page.locator('input[name="pw"]').fill('Pracownik!2026')
  await page.getByRole('button', { name: /Zaloguj/i }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })

  await page.goto('/analiza', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: /Strategiczny mózg/i }).first()).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(9_000)
  const tresc = await page.locator('main').innerText()

  // Własna karta MUSI się pojawić — inaczej test przeszedłby na pustym ekranie.
  expect(tresc).toContain('Anna Kowalska')

  // Granica RODO: ocena wydajności innych osób nie może wyciec do pracownika. Te nazwiska są widoczne
  // dla HR/ADMIN w „Mapie wydajności” na tym samym ekranie — więc gdyby scoping padł, pojawią się tutaj.
  for (const cudze of ['Rafał Adamczyk', 'Andrzej Kowalczyk', 'Marcin Dąbrowski', 'Tomasz Nowacki', 'Ewa Lewandowska']) {
    expect(tresc, `wyciek: pracownik widzi ocenę innej osoby (${cudze})`).not.toContain(cudze)
  }
})
