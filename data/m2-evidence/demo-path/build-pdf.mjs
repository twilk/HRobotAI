// Buduje PDF z materiału zebranego przez apps/web/e2e/demo-path.spec.ts.
//
// Wejście:  kroki.json + screenshots/*.png (oba produkowane przez spec)
// Wyjście:  Sciezka_demo_4Mobility_dowod.pdf
//
// Renderowanie przez Chrome DevTools Protocol — na tym boxie nie ma Worda ani LibreOffice, a ta
// ścieżka jest już w projekcie sprawdzona (docs/raport-km3/build/print-km3.mjs, wzorzec z KM2).
//
// Uruchomienie:  node data/m2-evidence/demo-path/build-pdf.mjs
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const ROOT = import.meta.dirname
const HTML_PATH = path.join(ROOT, 'raport.html')
const OUT = path.join(ROOT, 'Sciezka_demo_4Mobility_dowod.pdf')
const PORT = 9341
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'kroki.json'), 'utf8'))
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const dataWykonania = new Date(manifest.wykonano).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })

const kontaRows = Object.values(manifest.konta)
  .map(
    (k) => `<tr><td class="mono">${esc(k.login)}</td><td class="mono">${esc(k.haslo)}</td><td>${esc(k.opis)}</td></tr>`,
  )
  .join('')

// Kroki pogrupowane po sekcji, z zachowaniem kolejności przejścia.
const sekcje = []
for (const k of manifest.kroki) {
  let s = sekcje.find((x) => x.nazwa === k.sekcja)
  if (!s) sekcje.push((s = { nazwa: k.sekcja, kroki: [] }))
  s.kroki.push(k)
}

const sekcjeHtml = sekcje
  .map(
    (s) => `
  <section class="sekcja">
    <h2>${esc(s.nazwa)}</h2>
    ${s.kroki
      .map(
        (k) => `
    <article class="krok">
      <h3>${esc(k.tytul)}</h3>
      <table class="meta">
        <tr><th>Konto</th><td class="mono">${esc(k.konto)}</td></tr>
        <tr><th>Wykonana akcja</th><td>${esc(k.akcja)}</td></tr>
        <tr><th>Oczekiwany rezultat</th><td>${esc(k.oczekiwane)}</td></tr>
      </table>
      <table class="dane">
        <thead><tr><th colspan="2">Odczyt danych z systemu (dowód, że to nie jest sam obrazek)</th></tr></thead>
        <tbody>
          ${Object.entries(k.dane)
            .map(([kk, vv]) => `<tr><td>${esc(kk)}</td><td class="mono val">${esc(vv)}</td></tr>`)
            .join('')}
        </tbody>
      </table>
      <figure>
        <img src="screenshots/${esc(k.zrzut)}" alt="${esc(k.tytul)}">
        <figcaption>Zrzut ekranu: <span class="mono">${esc(k.zrzut)}</span></figcaption>
      </figure>
    </article>`,
      )
      .join('')}
  </section>`,
  )
  .join('')

const html = `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><title>Ścieżka demo 4Mobility — materiał dowodowy</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Calibri, Arial, sans-serif; color: #12172b; font-size: 10.5pt; line-height: 1.45; margin: 0; }
  h1 { font-family: Cambria, Georgia, serif; font-size: 22pt; color: #1E2761; margin: 0 0 4pt; }
  /* Nagłówek sekcji nigdy sam na dole strony — inaczej str. 1 kończyła się tytułem sekcji
     i pustym polem, bo pierwszy krok (page-break-inside: avoid) przeskakiwał na następną stronę. */
  h2 { font-family: Cambria, Georgia, serif; font-size: 14pt; color: #1E2761; margin: 0 0 10pt;
       padding-bottom: 4pt; border-bottom: 1.5pt solid #1E2761;
       page-break-after: avoid; break-after: avoid; }
  h3 { font-size: 11.5pt; color: #1E2761; margin: 0 0 6pt; }
  .lead { color: #5A6180; margin: 0 0 14pt; }
  table { width: 100%; border-collapse: collapse; margin: 0 0 8pt; }
  th, td { text-align: left; vertical-align: top; padding: 3.5pt 6pt; border: 0.5pt solid #D8DEF2; }
  .meta th { width: 32%; background: #F4F6FC; font-weight: 600; color: #1E2761; }
  .dane thead th { background: #1E2761; color: #fff; font-size: 9pt; font-weight: 600; }
  .dane td { font-size: 9.5pt; }
  .dane td:first-child { width: 55%; color: #5A6180; }
  .val { font-weight: 700; color: #12172b; }
  .mono { font-family: Consolas, "Courier New", monospace; font-size: 9pt; }
  .konta th { background: #1E2761; color: #fff; font-size: 9.5pt; }
  .ostrzezenie { border: 1pt solid #B8720A; background: #FBF3E7; padding: 7pt 9pt; margin: 0 0 14pt; font-size: 9.5pt; }
  .sekcja { page-break-before: always; }
  .sekcja:first-of-type { page-break-before: auto; }
  .krok { page-break-inside: avoid; margin: 0 0 16pt; }
  figure { margin: 0; page-break-inside: avoid; }
  img { width: 100%; border: 0.5pt solid #D8DEF2; }
  figcaption { font-size: 8pt; color: #9BA0B5; margin-top: 2pt; }
  .naglowek { border-bottom: 2pt solid #1E2761; padding-bottom: 8pt; margin-bottom: 14pt; }
  .meta-biegu { font-size: 9pt; color: #5A6180; }
</style></head><body>

<div class="naglowek">
  <h1>Ścieżka demo 4Mobility — materiał dowodowy</h1>
  <p class="lead">Pełne przejście scenariusza demonstracyjnego HRobot.AI, wykonane automatycznie na żywym środowisku.
  Każdy krok udokumentowany trzema rzeczami: wykonaną akcją, odczytem danych z API oraz zrzutem ekranu.</p>
  <p class="meta-biegu">
    Data i godzina biegu: <strong>${esc(dataWykonania)}</strong> (Europe/Warsaw)<br>
    Środowisko: <span class="mono">${esc(manifest.baza)}</span> · projekt compose <span class="mono">hrobot</span> · gałąź <span class="mono">feat/demo-4mobility</span><br>
    Sposób zebrania: <span class="mono">apps/web/e2e/demo-path.spec.ts</span> (Playwright, odtwarzalny jedną komendą)<br>
    Liczba udokumentowanych kroków: <strong>${manifest.kroki.length}</strong>
  </p>
</div>

<h2>Konta demonstracyjne</h2>
<table class="konta">
  <thead><tr><th>Login</th><th>Hasło</th><th>Rola i zakres</th></tr></thead>
  <tbody>${kontaRows}</tbody>
</table>
<div class="ostrzezenie">
  <strong>Zakres kont.</strong> Powyższe konta należą do środowiska demonstracyjnego
  (realm <span class="mono">hrobot-staging</span>) i operują wyłącznie na <strong>danych syntetycznych</strong> —
  nie ma wśród nich danych osobowych rzeczywistych pracowników. Konta nie dają dostępu do żadnego
  środowiska produkcyjnego. Dokument zawiera hasła na wyraźne życzenie odbiorcy, na potrzeby
  samodzielnego odtworzenia ścieżki; przy udostępnianiu poza zespół projektowy zalecana jest ich rotacja.
</div>

${sekcjeHtml}

</body></html>`

fs.writeFileSync(HTML_PATH, html, 'utf8')

const chrome = spawn(
  CHROME,
  [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--hide-scrollbars',
    '--disable-application-cache', '--disk-cache-size=1', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.TEMP}\\hr-demopath-${Date.now()}`,
    'file:///' + HTML_PATH.replace(/\\/g, '/'),
  ],
  { stdio: 'ignore' },
)

async function getPageWS() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json`)
      const list = await r.json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page.webSocketDebuggerUrl
    } catch {}
    await sleep(300)
  }
  throw new Error('DevTools endpoint nie wstał')
}

function rpc(ws, id, method, params) {
  return new Promise((resolve, reject) => {
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id === id) {
        ws.removeEventListener('message', onMsg)
        m.error ? reject(new Error(m.error.message)) : resolve(m.result)
      }
    }
    ws.addEventListener('message', onMsg)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

const wsUrl = await getPageWS()
const ws = new WebSocket(wsUrl)
await new Promise((res, rej) => {
  ws.addEventListener('open', res)
  ws.addEventListener('error', rej)
})
await rpc(ws, 1, 'Page.enable', {})
// 14 zrzutów pełnostronicowych — dajemy Chrome czas na dekodowanie, inaczej PDF łapie puste ramki.
await sleep(6000)

const footer = `<div style="width:100%; font-size:8px; color:#666; text-align:center; padding:0 12mm;">
  HRobot.AI · App Pro sp. z o.o. — Ścieżka demo 4Mobility, materiał dowodowy · dane syntetyczne ·
  Strona <span class="pageNumber"></span> / <span class="totalPages"></span></div>`

const result = await rpc(ws, 2, 'Page.printToPDF', {
  landscape: false,
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: footer,
  paperWidth: 8.27,
  paperHeight: 11.69,
  marginTop: 0.5,
  marginBottom: 0.55,
  marginLeft: 0.6,
  marginRight: 0.6,
  preferCSSPageSize: false,
})

fs.writeFileSync(OUT, Buffer.from(result.data, 'base64'))
console.log('ZAPISANO', OUT, (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB')
ws.close()
chrome.kill()
process.exit(0)
