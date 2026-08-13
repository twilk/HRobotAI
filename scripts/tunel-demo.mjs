/**
 * Stróż tunelu cloudflared dla udostępnienia testowego HRobot.
 *
 * PO CO. Tunel tymczasowy (`trycloudflare.com`) sam w sobie jest odporny na zmianę sieci: cloudflared
 * utrzymuje kilka połączeń do różnych lokalizacji brzegowych i przełącza się między nimi, zachowując
 * ten sam adres. Zmierzone na żywym tunelu: połączenie wędrowało `waw02 → ham03 → rix01`, a adres się
 * nie zmienił.
 *
 * Czego tunel tymczasowy NIE przeżyje, to śmierć własnego procesu — po restarcie Cloudflare przydziela
 * NOWY adres. Bez konta Cloudflare (brak `~/.cloudflared/cert.pem`) nie da się tego obejść tunelem
 * nazwanym ze stałą nazwą. Ten skrypt nie udaje, że problem znika: pilnuje, żeby tunel zawsze działał,
 * i głośno zapisuje nowy adres, gdy się zmieni.
 *
 * Uruchomienie:
 *   node scripts/tunel-demo.mjs            # startuje i pilnuje
 *   node scripts/tunel-demo.mjs --adres    # wypisuje bieżący adres i kończy
 *
 * Bieżący adres zawsze leży w pliku wskazanym przez PLIK_ADRESU — jeden punkt prawdy, także po
 * restarcie tunelu.
 */
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const KATALOG = join(process.cwd(), '.tunel')
const PLIK_ADRESU = join(KATALOG, 'adres.txt')
const PLIK_HISTORII = join(KATALOG, 'historia.log')
const PLIK_LOGU = join(KATALOG, 'cloudflared.log')
const PORT_LOKALNY = 'http://localhost:8080'

/** Ile czekać przed ponownym startem po śmierci procesu. Krótko — to udostępnienie na żywo. */
const PRZERWA_PRZED_RESTARTEM_MS = 3000
/** Co ile sprawdzać, czy tunel naprawdę odpowiada (żywy proces ≠ działający tunel). */
const OKRES_SONDY_MS = 30_000

function teraz() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

function zapiszHistorie(linia) {
  mkdirSync(KATALOG, { recursive: true })
  appendFileSync(PLIK_HISTORII, `${teraz()}  ${linia}\n`, 'utf8')
  console.log(`[${teraz()}] ${linia}`)
}

if (process.argv.includes('--adres')) {
  if (!existsSync(PLIK_ADRESU)) {
    console.error('Brak zapisanego adresu — czy stróż tunelu działa? (node scripts/tunel-demo.mjs)')
    process.exit(1)
  }
  console.log(readFileSync(PLIK_ADRESU, 'utf8').trim())
  process.exit(0)
}

mkdirSync(KATALOG, { recursive: true })

let dziecko = null
let adresBiezacy = existsSync(PLIK_ADRESU) ? readFileSync(PLIK_ADRESU, 'utf8').trim() : null
let zatrzymywanie = false

function ustawAdres(nowy) {
  if (nowy === adresBiezacy) return
  const poprzedni = adresBiezacy
  adresBiezacy = nowy
  writeFileSync(PLIK_ADRESU, `${nowy}\n`, 'utf8')
  zapiszHistorie(
    poprzedni
      ? `ADRES ZMIENIONY: ${poprzedni} -> ${nowy}  (przekaż nowy testerowi)`
      : `ADRES: ${nowy}`,
  )
}

function start() {
  if (zatrzymywanie) return
  zapiszHistorie('start cloudflared…')
  dziecko = spawn('cloudflared', ['tunnel', '--url', PORT_LOKALNY, '--no-autoupdate'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const czytaj = (buf) => {
    const tekst = buf.toString()
    appendFileSync(PLIK_LOGU, tekst, 'utf8')
    const m = tekst.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
    if (m) ustawAdres(m[0])
  }
  dziecko.stdout.on('data', czytaj)
  dziecko.stderr.on('data', czytaj)

  dziecko.on('exit', (kod, sygnal) => {
    dziecko = null
    if (zatrzymywanie) return
    zapiszHistorie(`cloudflared zakończył się (kod=${kod} sygnał=${sygnal}) — restart za ${PRZERWA_PRZED_RESTARTEM_MS / 1000} s`)
    setTimeout(start, PRZERWA_PRZED_RESTARTEM_MS)
  })
}

/**
 * Sonda: żywy proces nie znaczy działający tunel. Sprawdzamy, czy adres realnie odpowiada; jeśli nie
 * odpowiada dwa razy z rzędu, ubijamy proces i pozwalamy obsłudze `exit` postawić go od nowa.
 */
let nieudaneSondy = 0
setInterval(async () => {
  if (!adresBiezacy || !dziecko) return
  try {
    const odp = await fetch(`${adresBiezacy}/login`, { redirect: 'manual', signal: AbortSignal.timeout(15_000) })
    if (odp.status >= 200 && odp.status < 500) {
      if (nieudaneSondy > 0) zapiszHistorie(`sonda znów OK (HTTP ${odp.status})`)
      nieudaneSondy = 0
      return
    }
    throw new Error(`HTTP ${odp.status}`)
  } catch (e) {
    nieudaneSondy += 1
    zapiszHistorie(`sonda nieudana (${nieudaneSondy}/2): ${e instanceof Error ? e.message : e}`)
    if (nieudaneSondy >= 2) {
      nieudaneSondy = 0
      zapiszHistorie('tunel nie odpowiada — ubijam proces, żeby wymusić odbudowę')
      dziecko?.kill()
    }
  }
}, OKRES_SONDY_MS)

for (const s of ['SIGINT', 'SIGTERM']) {
  process.on(s, () => {
    zatrzymywanie = true
    zapiszHistorie(`otrzymano ${s} — zatrzymuję tunel`)
    dziecko?.kill()
    process.exit(0)
  })
}

start()
