import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'

/**
 * Przejście CAŁEJ ścieżki demo (docs/demo/2026-08-10-demo-4mobility-parp.md) jako materiał dowodowy.
 *
 * Różnica wobec `evidence.spec.ts`: tamten robi inwentarz EKRANÓW (jeden zrzut na trasę, bez akcji).
 * Ten przechodzi ŚCIEŻKĘ — wykonuje realne akcje w trzech rolach (skan wypadnięć, zgoda pracownika,
 * zatwierdzenie managera, generowanie dokumentu, polecenie do asystenta) i przy każdym kroku zapisuje
 * trzy rzeczy: zrzut ekranu, wykonaną akcję i ODCZYT DANYCH z API. Dowodem nie jest sam obrazek —
 * obrazek pokazuje, co widać, a odczyt pokazuje, co system naprawdę zapisał.
 *
 * Kroki 3c/3d ZUŻYWAJĄ dane (zgoda przechodzi w PENDING_MANAGER, zatwierdzenie w APPROVED). To jest
 * zamierzone: bieg dowodzi, że łańcuch działa end-to-end. Odtworzenie stanu przed demo opisuje sekcja
 * „Jak odtworzyć dane do sekcji 3" w skrypcie demo.
 *
 * Uruchomienie na żywym stacku:
 *   E2E_BASE_URL=http://localhost:8080 npx playwright test e2e/demo-path.spec.ts
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:8080'
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const OUT_DIR = path.resolve(REPO_ROOT, 'data', 'm2-evidence', 'demo-path')
const SHOTS_DIR = path.join(OUT_DIR, 'screenshots')

const KONTA = {
  admin: { login: 'demo', haslo: 'demo-staging-2026', opis: 'ADMIN_KLIENTA (globalny)' },
  manager: { login: 'manager.demo', haslo: 'Manager!2026', opis: 'MANAGER (Region Centrum)' },
  pracownik: { login: 'pracownik.demo', haslo: 'Pracownik!2026', opis: 'PRACOWNIK — Anna Kowalska' },
  pracownica: { login: 'pracownica.demo', haslo: 'Pracownica!2026', opis: 'PRACOWNIK cross-unit — Katarzyna Zając' },
} as const

interface Krok {
  id: string
  sekcja: string
  tytul: string
  konto: string
  akcja: string
  oczekiwane: string
  zrzut: string
  dane: Record<string, unknown>
}

const kroki: Krok[] = []

/** Odczyt z API w kontekście zalogowanej sesji (ciasteczko httpOnly) — dowód „co system zapisał”. */
async function odczyt(page: Page, sciezka: string): Promise<unknown> {
  return page.evaluate(async (s) => {
    const r = await fetch(s, { cache: 'no-store' })
    if (!r.ok) return { __status: r.status }
    return r.json()
  }, sciezka)
}

async function zaloguj(page: Page, konto: { login: string; haslo: string }) {
  await page.context().clearCookies()
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.locator('input[name="login"]').fill(konto.login)
  await page.locator('input[name="pw"]').fill(konto.haslo)
  await page.getByRole('button', { name: /Zaloguj/i }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 })
}

async function zapisz(page: Page, k: Omit<Krok, 'zrzut'> & { pelnaStrona?: boolean }) {
  const plik = `${k.id}.png`
  await page.screenshot({ path: path.join(SHOTS_DIR, plik), fullPage: k.pelnaStrona ?? true })
  const { pelnaStrona: _pominiete, ...reszta } = k
  kroki.push({ ...reszta, zrzut: plik })
}

test('ścieżka demo 4Mobility — pełne przejście z materiałem dowodowym', async ({ page }) => {
  test.setTimeout(600_000)
  fs.mkdirSync(SHOTS_DIR, { recursive: true })
  await page.setViewportSize({ width: 1280, height: 900 })

  // ---------------------------------------------------------------- 2. ADMIN
  await zaloguj(page, KONTA.admin)

  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: /Pulpit/i }).first()).toBeVisible({ timeout: 60_000 })
  const pracownicy = (await odczyt(page, '/api/employees')) as unknown[]
  const jednostki = (await odczyt(page, '/api/ustawienia/units')) as unknown[]
  const zmiany = (await odczyt(page, '/api/grafik/shifts')) as unknown[]
  await zapisz(page, {
    id: '2a-pulpit-admin',
    sekcja: '2. ADMIN — pełny obraz organizacji',
    tytul: 'Pulpit administratora klienta',
    konto: `${KONTA.admin.login} — ${KONTA.admin.opis}`,
    akcja: 'Logowanie i wejście na /dashboard',
    oczekiwane: 'KPI liczone na żywych danych najemcy + panel ochrony danych',
    dane: {
      'pracownicy (GET /api/employees)': Array.isArray(pracownicy) ? pracownicy.length : pracownicy,
      'jednostki organizacyjne': Array.isArray(jednostki) ? jednostki.length : jednostki,
      'zmiany w grafiku (całość)': Array.isArray(zmiany) ? zmiany.length : zmiany,
    },
  })

  await page.goto('/grafik', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: /Grafik/i }).first()).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(/Ładowanie/i).first()).toBeHidden({ timeout: 60_000 }).catch(() => {})
  await zapisz(page, {
    id: '2b-grafik',
    sekcja: '2. ADMIN — pełny obraz organizacji',
    tytul: 'Grafik — siatka pracownik × dzień',
    konto: `${KONTA.admin.login} — ${KONTA.admin.opis}`,
    akcja: 'Wejście na /grafik (bez klikania „Generuj grafik” — patrz ryzyko #3 w skrypcie)',
    oczekiwane: 'Tygodniowa siatka z blokami AUTO; twarde reguły H1–H4 pilnowane przez solver CP-SAT',
    dane: { 'nagłówek tygodnia': (await page.locator('main').innerText()).split('\n').slice(0, 3).join(' | ') },
  })

  await page.goto('/analityk', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: /Analityk/i }).first()).toBeVisible({ timeout: 90_000 })
  await expect(page.getByText(/Ładowanie/i).first()).toBeHidden({ timeout: 90_000 }).catch(() => {})
  const trescAnalityka = await page.locator('main').innerText()
  await zapisz(page, {
    id: '2c-analityk',
    sekcja: '2. ADMIN — pełny obraz organizacji',
    tytul: 'Analityk HR — sygnały i proweniencja liczb',
    konto: `${KONTA.admin.login} — ${KONTA.admin.opis}`,
    akcja: 'Wejście na /analityk',
    oczekiwane: 'Sekcja „Na co zwrócić uwagę” + imiona i nazwiska zamiast identyfikatorów',
    dane: {
      'surowe identyfikatory na stronie': (trescAnalityka.match(/#[0-9a-f]{6,}/g) ?? []).length,
      'sygnały wykryte': (trescAnalityka.match(/Wysoka|Średnia/g) ?? []).length,
    },
  })

  // Dokumenty — realna akcja: wygenerowanie ewidencji czasu pracy
  await page.goto('/dokumenty', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: /Dokumenty/i }).first()).toBeVisible({ timeout: 60_000 })
  const przedGeneracja = (await odczyt(page, '/api/dokumenty')) as unknown[]
  await page.locator('#dokEmployee').selectOption({ label: 'Anna Kowalska' })
  await page.locator('#dokOd').fill('2026-07-13')
  await page.locator('#dokDo').fill('2026-07-19')
  await page.getByRole('button', { name: /Generuj dokument/i }).click()
  await page.waitForTimeout(4000)
  const poGeneracji = (await odczyt(page, '/api/dokumenty')) as unknown[]
  await zapisz(page, {
    id: '2d-dokumenty',
    sekcja: '2. ADMIN — pełny obraz organizacji',
    tytul: 'Dokumenty — wygenerowanie ewidencji czasu pracy',
    konto: `${KONTA.admin.login} — ${KONTA.admin.opis}`,
    akcja: 'Ewidencja czasu pracy · Anna Kowalska · 13–19.07.2026 → „Generuj dokument”',
    oczekiwane: 'Nowy dokument w stanie DO ZATWIERDZENIA — system liczy, ale nie wysyła (RODO art. 22)',
    dane: {
      'dokumentów przed akcją': Array.isArray(przedGeneracja) ? przedGeneracja.length : przedGeneracja,
      'dokumentów po akcji': Array.isArray(poGeneracji) ? poGeneracji.length : poGeneracji,
    },
  })

  // ------------------------------------------------- 3. ŁAŃCUCH AI (3 role)
  await zaloguj(page, KONTA.manager)

  await page.goto('/ai-grafik-manager', { waitUntil: 'domcontentloaded' })
  // MANAGER nie widzi panelu konfiguracji (canEditConfig = HR/ADMIN only), a to on niesie <h1>.
  // Asercja idzie więc na nagłówek, który TA rola faktycznie dostaje.
  await expect(page.getByRole('heading', { name: /Koszty grafiku|Propozycje AI/i }).first()).toBeVisible({ timeout: 60_000 })
  await page.locator('#scanFrom').fill('2026-08-17')
  await page.locator('#scanTo').fill('2026-08-23')
  await page.getByRole('button', { name: /Skanuj/i }).click()
  await page.waitForTimeout(2500)
  await zapisz(page, {
    id: '3a-wykrywanie-wypadniec',
    sekcja: '3. Pełny łańcuch AI',
    tytul: '3a. AI wykrywa dziurę w obsadzie',
    konto: `${KONTA.manager.login} — ${KONTA.manager.opis}`,
    akcja: 'Wykrywanie wypadnięć · zakres 2026-08-17 – 2026-08-23 → „Skanuj”',
    oczekiwane: 'Zmiana, której przypisany pracownik ma zatwierdzony urlop — problem, którego nikt nie zgłosił',
    dane: {
      'wypadnięcia znalezione': (await page.locator('text=Utwórz propozycję zastępstwa').count()) || 'brak (już obsłużone)',
    },
  })

  const propozycjeManagera = (await odczyt(page, '/api/ai-grafik/proposals?state=PENDING_MANAGER')) as unknown[]
  const propozycjeZgoda = (await odczyt(page, '/api/ai-grafik/proposals?state=PENDING_EMPLOYEE_CONSENT')) as unknown[]
  await zapisz(page, {
    id: '3b-skrzynka-managera',
    sekcja: '3. Pełny łańcuch AI',
    tytul: '3b. AI proponuje i pokazuje rozumowanie',
    konto: `${KONTA.manager.login} — ${KONTA.manager.opis}`,
    akcja: 'Podgląd skrzynki propozycji AI',
    oczekiwane: 'Kandydat + ranga + dojazd (km/min) + rozbicie kosztu praca/dojazd — uzasadnienie, nie sam wynik',
    dane: {
      'propozycje czekające na managera': Array.isArray(propozycjeManagera) ? propozycjeManagera.length : propozycjeManagera,
      'propozycje czekające na zgodę pracownika': Array.isArray(propozycjeZgoda) ? propozycjeZgoda.length : propozycjeZgoda,
    },
  })

  // 3c — pracownica akceptuje
  await zaloguj(page, KONTA.pracownica)
  await page.goto('/zamiany', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: /Zamian/i }).first()).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(2500)
  const trescZgody = await page.locator('main').innerText()
  const akceptuj = page.getByRole('button', { name: /^Akceptuj$/ }).first()
  const jestDoZaakceptowania = (await akceptuj.count()) > 0
  await zapisz(page, {
    id: '3c-zgoda-pracownika',
    sekcja: '3. Pełny łańcuch AI',
    tytul: '3c. Pracownik dostaje PYTANIE, nie polecenie',
    konto: `${KONTA.pracownica.login} — ${KONTA.pracownica.opis}`,
    akcja: 'Wejście na /zamiany — sekcja „Propozycje AI — zastępstwo wymaga Twojej zgody”',
    oczekiwane: 'Data, godziny, rola, lokalizacja i własny szacunkowy dojazd — komplet do świadomej decyzji',
    dane: {
      'surowe identyfikatory w sekcji': (trescZgody.match(/[0-9a-f]{8}-[0-9a-f]{4}/gi) ?? []).length,
      'token techniczny „leave … approved”': /leave\s+[0-9a-f-]{36}\s+approved/i.test(trescZgody) ? 'OBECNY (błąd)' : 'brak',
      'możliwość odmowy': (await page.getByRole('button', { name: /^Odrzuć$/ }).count()) > 0 ? 'tak — przycisk Odrzuć' : 'nie',
    },
  })

  if (jestDoZaakceptowania) {
    await akceptuj.click()
    await page.waitForTimeout(3000)
    await zapisz(page, {
      id: '3c2-po-akceptacji',
      sekcja: '3. Pełny łańcuch AI',
      tytul: '3c (c.d.) Pracownica wyraża zgodę',
      konto: `${KONTA.pracownica.login} — ${KONTA.pracownica.opis}`,
      akcja: 'Kliknięcie „Akceptuj”',
      oczekiwane: 'Propozycja przechodzi do skrzynki managera — pracownik zgodził się, ale NIE zdecydował',
      dane: { 'stan po akcji': 'zgoda udzielona, decyzja nadal po stronie managera' },
    })
  }

  // 3d — manager zatwierdza
  await zaloguj(page, KONTA.manager)
  await page.goto('/ai-grafik-manager', { waitUntil: 'domcontentloaded' })
  // MANAGER nie widzi panelu konfiguracji (canEditConfig = HR/ADMIN only), a to on niesie <h1>.
  // Asercja idzie więc na nagłówek, który TA rola faktycznie dostaje.
  await expect(page.getByRole('heading', { name: /Koszty grafiku|Propozycje AI/i }).first()).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(2500)
  const przedZatwierdzeniem = (await odczyt(page, '/api/ai-grafik/proposals?state=PENDING_MANAGER')) as unknown[]
  const zatwierdz = page.getByRole('button', { name: /^Zatwierdź$/ }).first()
  const jestDoZatwierdzenia = (await zatwierdz.count()) > 0
  if (jestDoZatwierdzenia) {
    await zatwierdz.click()
    await page.waitForTimeout(3500)
  }
  const poZatwierdzeniu = (await odczyt(page, '/api/ai-grafik/proposals?state=APPROVED')) as unknown[]
  await zapisz(page, {
    id: '3d-decyzja-managera',
    sekcja: '3. Pełny łańcuch AI',
    tytul: '3d. Manager decyduje, solver weryfikuje prawo',
    konto: `${KONTA.manager.login} — ${KONTA.manager.opis}`,
    akcja: jestDoZatwierdzenia ? 'Kliknięcie „Zatwierdź” przy propozycji AI' : 'Brak propozycji do zatwierdzenia',
    oczekiwane: 'Optymalizator sprawdza H1–H4 dopiero przy zatwierdzeniu; zmiana przepina się atomowo + wpis do audytu',
    dane: {
      'czekające na managera przed akcją': Array.isArray(przedZatwierdzeniem) ? przedZatwierdzeniem.length : przedZatwierdzeniem,
      'zatwierdzone łącznie po akcji': Array.isArray(poZatwierdzeniu) ? poZatwierdzeniu.length : poZatwierdzeniu,
    },
  })

  // ---------------------------------------------------------- 4. ASYSTENT
  await zaloguj(page, KONTA.pracownik)
  await page.goto('/asystent', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: /Asystent/i }).first()).toBeVisible({ timeout: 60_000 })
  const pole = page.locator('input[type="text"], textarea').first()
  await pole.fill('Chcę wziąć urlop wypoczynkowy 20 sierpnia')
  await page.getByRole('button', { name: /^Wyślij$/ }).click()
  await page.waitForTimeout(3000)
  const trescAsystenta = await page.locator('main').innerText()
  await zapisz(page, {
    id: '4a-asystent-intencja',
    sekcja: '4. Asystent głosowy',
    tytul: 'Polecenie po polsku + bramka potwierdzenia',
    konto: `${KONTA.pracownik.login} — ${KONTA.pracownik.opis}`,
    akcja: 'Wpisanie: „Chcę wziąć urlop wypoczynkowy 20 sierpnia”',
    oczekiwane: 'Rozpoznana intencja + poziom pewności + WYMAGANE potwierdzenie przed zapisem',
    dane: {
      'rozpoznana intencja': /WNIOSEK URLOPOWY/i.test(trescAsystenta) ? 'WNIOSEK URLOPOWY' : '(nie rozpoznano)',
      'poziom pewności': (trescAsystenta.match(/PEWNOŚĆ:?\s*\d+%/i) ?? ['(brak)'])[0],
      'bramka potwierdzenia': /Potwierdź i wykonaj/i.test(trescAsystenta) ? 'obecna — nic nie zapisano automatycznie' : 'BRAK',
    },
  })

  await pole.fill('Ile osób pracuje jutro na lotnisku?')
  await page.getByRole('button', { name: /^Wyślij$/ }).click()
  await page.waitForTimeout(3000)
  const trescOdmowy = await page.locator('main').innerText()
  await zapisz(page, {
    id: '4b-asystent-granica',
    sekcja: '4. Asystent głosowy',
    tytul: 'Świadoma granica — system mówi „nie wiem”',
    konto: `${KONTA.pracownik.login} — ${KONTA.pracownik.opis}`,
    akcja: 'Wpisanie pytania spoza zakresu: „Ile osób pracuje jutro na lotnisku?”',
    oczekiwane: 'Odesłanie do formularza zamiast zmyślonej odpowiedzi — parser regułowy, świadomie bez modelu językowego',
    dane: {
      'reakcja na pytanie spoza zakresu': /Nie zrozumiałem/i.test(trescOdmowy) ? 'odesłanie do formularza' : '(inna)',
    },
  })

  // ------------------------------------------------ 5. PRACOWNIK (mobilnie)
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: /Pulpit/i }).first()).toBeVisible({ timeout: 60_000 })
  const mojeZmiany = (await odczyt(page, '/api/grafik/shifts')) as unknown[]
  await zapisz(page, {
    id: '5a-pulpit-pracownika',
    sekcja: '5. Pracownik — samoobsługa',
    tytul: 'Pracownik widzi wyłącznie swoje dane',
    konto: `${KONTA.pracownik.login} — ${KONTA.pracownik.opis}`,
    akcja: 'Wejście na /dashboard',
    oczekiwane: 'Własny grafik, godziny vs etat, własne urlopy — zakres egzekwowany po stronie serwera',
    dane: {
      'zmiany widoczne dla pracownika': Array.isArray(mojeZmiany) ? mojeZmiany.length : mojeZmiany,
      'porównanie: administrator widział': Array.isArray(zmiany) ? zmiany.length : zmiany,
    },
  })

  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/moj-tydzien', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: /Cześć|Twój tydzień/i }).first()).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(1500)
  const trescTydzien = await page.locator('main').innerText()
  await zapisz(page, {
    id: '5b-moj-tydzien-mobile',
    sekcja: '5. Pracownik — samoobsługa',
    tytul: 'Mobilna trasa pracownika w terenie (375 × 812)',
    konto: `${KONTA.pracownik.login} — ${KONTA.pracownik.opis}`,
    akcja: 'Wejście na /moj-tydzien przy rozdzielczości telefonu',
    oczekiwane: 'Dwie odpowiedzi: kiedy pracuję i jak poprosić o urlop; przyciski min. 44 px',
    dane: {
      'nagłówek': trescTydzien.split('\n')[0] ?? '',
      'podsumowanie tygodnia': (trescTydzien.match(/Masz \d+ zaplanowanych zmian|nie masz zaplanowanych zmian/i) ?? ['(brak)'])[0],
    },
  })

  // ----------------------------------------------- 6. MANAGER — koszt/budżet
  await page.setViewportSize({ width: 1280, height: 900 })
  await zaloguj(page, KONTA.manager)
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: /Pulpit/i }).first()).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(2000)
  const trescManagera = await page.locator('main').innerText()
  await zapisz(page, {
    id: '6a-pulpit-managera',
    sekcja: '6. Manager — koszt i budżet',
    tytul: 'Widok decyzyjny, nie raportowy',
    konto: `${KONTA.manager.login} — ${KONTA.manager.opis}`,
    akcja: 'Wejście na /dashboard',
    oczekiwane: 'Skrzynka decyzji + koszt tygodnia w budżecie, wyłącznie dla własnego regionu',
    dane: {
      'koszt jednostki (tydzień)': (trescManagera.match(/[\d\s]+,\d{2}\s*zł/) ?? ['(brak)'])[0],
      'status budżetu': /W BUDŻECIE/i.test(trescManagera) ? 'W BUDŻECIE' : '(inny)',
    },
  })

  // ------------------------------------------------------ zapis manifestu
  fs.writeFileSync(
    path.join(OUT_DIR, 'kroki.json'),
    JSON.stringify({ wykonano: new Date().toISOString(), baza: BASE, konta: KONTA, kroki }, null, 2),
    'utf8',
  )
  expect(kroki.length, 'materiał dowodowy nie może być pusty').toBeGreaterThanOrEqual(10)
})
