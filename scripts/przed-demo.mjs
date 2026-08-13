/**
 * Kontrola przed demo — jedna komenda zamiast sześciu.
 *
 *   node scripts/przed-demo.mjs
 *
 * Sprawdza dwie warstwy, bo każda potrafi zawieść osobno:
 *  1. STAN — kontenery, dane sekcji 3, przypisanie zmiany, model mowy;
 *  2. EKRANY — realnie przechodzi dziewięć widoków ze scenariusza czterema kontami i szuka rzeczy,
 *     które kompromitują na sali: surowych identyfikatorów, bannerów błędu, pustych ekranów,
 *     `undefined` w treści, odpowiedzi 5xx.
 *
 * Warstwa 2 istnieje, bo warstwa 1 potrafi być zielona przy zepsutym ekranie. 11.08 wszystkie
 * kontenery były `healthy`, a `/zamiany` pokazywało `e0ebd707` w miejscu daty i godziny.
 *
 * Kod wyjścia 0 = można wpuszczać odbiorcę. Cokolwiek innego = przeczytaj, co wypisało.
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const BASE = process.env.DEMO_URL ?? 'http://localhost:8080'
const require_ = createRequire('file:///C:/Users/Wilk/Documents/WORKSPACE/HRobot-m2/apps/web/')
const { chromium } = require_('@playwright/test')

const KONTA = {
  admin: ['demo', 'demo-staging-2026'],
  manager: ['manager.demo', 'Manager!2026'],
  pracownica: ['pracownica.demo', 'Pracownica!2026'],
  pracownik: ['pracownik.demo', 'Pracownik!2026'],
}

const PLAN = [
  [KONTA.admin, ['/dashboard', '/grafik', '/analiza', '/dokumenty']],
  [KONTA.manager, ['/ai-grafik-manager', '/dashboard']],
  [KONTA.pracownica, ['/zamiany']],
  [KONTA.pracownik, ['/asystent', '/moj-tydzien']],
]

const wyniki = []
const dodaj = (co, ok, szczegol) => {
  wyniki.push({ co, ok, szczegol })
  console.log(`${ok ? '  OK  ' : ' BŁĄD '} ${co.padEnd(38)} ${szczegol}`)
}

function psql(sql) {
  return execFileSync(
    'docker',
    ['exec', '-i', 'hrobot-postgres-1', 'psql', '-U', 'postgres', '-d', 'hrobot_t_900d948b', '-t', '-A', '-c', sql],
    { encoding: 'utf8' },
  ).trim()
}

console.log('\n=== STAN ===')

try {
  const zdrowe = execFileSync('docker', ['compose', '-p', 'hrobot', 'ps', '--format', '{{.Status}}'], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter((l) => l.includes('healthy')).length
  dodaj('kontenery healthy', zdrowe === 10, `${zdrowe}/10`)
} catch (e) {
  dodaj('kontenery healthy', false, String(e).slice(0, 60))
}

try {
  const zgody = Number(psql("SELECT count(*) FROM ai_proposal WHERE state='PENDING_EMPLOYEE_CONSENT'"))
  const rezerwa = Number(psql("SELECT count(*) FROM ai_proposal WHERE state='PENDING_MANAGER'"))
  dodaj('sekcja 3c ma czym działać', zgody >= 1, `${zgody} zgoda(y) oczekująca, ${rezerwa} w rezerwie u managera`)

  // Propozycja ma OKNO WAŻNOŚCI 24 h (`ai_proposal.expires_at`); po nim scheduler przepina ją na
  // ESCALATED bez niczyjego udziału. Zgubiliśmy tak sekcję 3c w nocy 12/13.08 — stan był zielony
  // wieczorem i pusty rano. Godziny do wygaśnięcia są tu ważniejsze niż samo „jest/nie ma”.
  if (zgody >= 1) {
    const godzin = Number(
      psql(
        "SELECT round(EXTRACT(EPOCH FROM (min(expires_at) - now()))/3600, 1) " +
          "FROM ai_proposal WHERE state='PENDING_EMPLOYEE_CONSENT'",
      ),
    )
    dodaj(
      'zgoda nie wygaśnie przed demo',
      godzin >= 2,
      godzin >= 2
        ? `wygasa za ${godzin} h`
        : `UWAGA: wygasa za ${godzin} h — odtwórz dane TERAZ, inaczej sekcja 3c będzie pusta`,
    )
  }
} catch (e) {
  dodaj('sekcja 3c ma czym działać', false, String(e).slice(0, 60))
}

try {
  const kto = psql(
    "SELECT e.first_name||' '||e.last_name FROM shifts s JOIN employees e ON e.id=s.employee_id " +
      "WHERE s.date::date='2026-08-20' AND s.start='14:00' AND s.role='KOORDYNATOR'",
  )
  dodaj('sekcja 3a: zmiana Anny 20.08', kto === 'Anna Kowalska', kto || '(brak przypisania)')
} catch (e) {
  dodaj('sekcja 3a: zmiana Anny 20.08', false, String(e).slice(0, 60))
}

try {
  const h = await (await fetch('http://localhost:8011/health', { signal: AbortSignal.timeout(8000) })).json()
  // `loaded: false` nie psuje demo, ale PIERWSZA transkrypcja potrwa ~40 s zamiast kilkunastu.
  dodaj('model mowy w pamięci', h.loaded === true, h.loaded ? 'loaded' : 'NIE — zrób próbne nagranie przed wejściem odbiorcy')
} catch (e) {
  dodaj('model mowy w pamięci', false, String(e).slice(0, 60))
}

console.log('\n=== EKRANY (realne przejście) ===')

const browser = await chromium.launch()
for (const [[login, haslo], trasy] of PLAN) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
  const page = await ctx.newPage()
  const bledy5xx = []
  page.on('response', (r) => {
    if (r.status() >= 500) bledy5xx.push(`${r.status()} ${r.url().replace(BASE, '')}`)
  })
  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.locator('input[name="login"]').fill(login)
    await page.locator('input[name="pw"]').fill(haslo)
    await page.getByRole('button', { name: /Zaloguj/i }).click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 45000 })
  } catch (e) {
    dodaj(`logowanie ${login}`, false, String(e).slice(0, 60))
    await ctx.close()
    continue
  }

  for (const t of trasy) {
    await page.goto(BASE + t, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForTimeout(t === '/analiza' ? 9000 : 3500)
    const d = await page.evaluate(() => {
      const m = document.querySelector('main')
      const txt = m ? m.innerText : ''
      return {
        goleId: (txt.match(/#?\b[0-9a-f]{8}\b/g) || []).filter((s) => !/^\d+$/.test(s)),
        stanowisko: (txt.match(/recepcj/gi) || []).length,
        blad: /Nie udało się|Brak dostępu|Coś poszło nie tak|HTTP \d{3}|Application error/i.test(txt),
        pusto: txt.trim().length < 120,
        smieci: /undefined|NaN/.test(txt),
      }
    })
    const problemy = []
    if (d.goleId.length) problemy.push(`surowe ID (${d.goleId.slice(0, 2).join(', ')})`)
    if (d.stanowisko) problemy.push(`stara nazwa stanowiska x${d.stanowisko}`)
    if (d.blad) problemy.push('banner błędu')
    if (d.pusto) problemy.push('pusty ekran')
    if (d.smieci) problemy.push('undefined/NaN w treści')
    if (bledy5xx.length) problemy.push(`5xx: ${bledy5xx.slice(0, 2).join(', ')}`)
    dodaj(`${login} ${t}`, problemy.length === 0, problemy.join(' | ') || 'czysto')
    bledy5xx.length = 0
  }
  await ctx.close()
}
await browser.close()

const zle = wyniki.filter((w) => !w.ok)
console.log('\n' + '─'.repeat(70))
if (zle.length === 0) {
  console.log('GOTOWE — stan i wszystkie ekrany czyste. Można wpuszczać odbiorcę.')
  process.exit(0)
}
console.log(`DO SPRAWDZENIA — ${zle.length} pozycji:`)
for (const z of zle) console.log(`  • ${z.co}: ${z.szczegol}`)
console.log('\nOdtworzenie danych sekcji 3 opisuje docs/demo/2026-08-10-demo-4mobility-parp.md.')
process.exit(1)
