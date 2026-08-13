/**
 * Walidator strukturalny RFC 5545 dla wyjścia `buildLeaveCalendar`. Nie jest pełnym parserem
 * iCalendara i nie udaje nim być — sprawdza dokładnie te klauzule, na które kryterium akceptacji E-1
 * się powołuje, i każde naruszenie nazywa numerem klauzuli. Świadomie w repo, a nie jako zależność
 * npm: pakiet, którego nikt nie audytował, byłby gorszym dowodem niż siedem sprawdzeń, które da się
 * przeczytać.
 */

const MAX_LINE_OCTETS = 75
const WYMAGANE_W_VEVENT = ['UID', 'DTSTAMP', 'DTSTART'] as const

/** Lista naruszeń. Pusta = plik przechodzi walidację. */
export function validateIcs(text: string): string[] {
  const bledy: string[] = []

  if (/(?<!\r)\n/.test(text) || /\r(?!\n)/.test(text)) {
    bledy.push('RFC 5545 §3.1: każdy wiersz musi kończyć się sekwencją CRLF')
  }
  if (!text.endsWith('\r\n')) {
    bledy.push('RFC 5545 §3.1: plik musi kończyć się sekwencją CRLF')
  }

  const surowe = text.split('\r\n')
  while (surowe.length > 0 && surowe[surowe.length - 1] === '') surowe.pop()

  surowe.forEach((w, i) => {
    const oktety = Buffer.byteLength(w, 'utf8')
    if (oktety > MAX_LINE_OCTETS) {
      bledy.push(
        `RFC 5545 §3.1: wiersz ${i + 1} ma ${oktety} oktetów (limit ${MAX_LINE_OCTETS}, brak zwijania)`,
      )
    }
  })

  // Rozwiń zwinięte wiersze: kontynuacja zaczyna się od pojedynczej spacji.
  const logiczne: string[] = []
  for (const w of surowe) {
    if (w.startsWith(' ') && logiczne.length > 0) logiczne[logiczne.length - 1] += w.slice(1)
    else logiczne.push(w)
  }

  if (logiczne[0] !== 'BEGIN:VCALENDAR') {
    bledy.push('RFC 5545 §3.4: pierwszym wierszem musi być BEGIN:VCALENDAR')
  }
  if (logiczne[logiczne.length - 1] !== 'END:VCALENDAR') {
    bledy.push('RFC 5545 §3.4: ostatnim wierszem musi być END:VCALENDAR')
  }
  if (!logiczne.includes('VERSION:2.0')) {
    bledy.push('RFC 5545 §3.7.4: brak obowiązkowej własności VERSION:2.0')
  }
  if (!logiczne.some((w) => w.startsWith('PRODID:'))) {
    bledy.push('RFC 5545 §3.7.3: brak obowiązkowej własności PRODID')
  }

  let wZdarzeniu = false
  let nazwy: string[] = []
  for (const w of logiczne) {
    if (w === 'BEGIN:VEVENT') {
      if (wZdarzeniu) bledy.push('RFC 5545 §3.6.1: zagnieżdżony BEGIN:VEVENT')
      wZdarzeniu = true
      nazwy = []
      continue
    }
    if (w === 'END:VEVENT') {
      if (!wZdarzeniu) {
        bledy.push('RFC 5545 §3.6.1: END:VEVENT bez odpowiadającego BEGIN:VEVENT')
        continue
      }
      for (const wymagana of WYMAGANE_W_VEVENT) {
        if (!nazwy.includes(wymagana)) {
          bledy.push(`RFC 5545 §3.6.1: VEVENT bez obowiązkowej własności ${wymagana}`)
        }
      }
      wZdarzeniu = false
      continue
    }
    if (wZdarzeniu) {
      const dwukropek = w.indexOf(':')
      const zParametrami = dwukropek > 0 ? w.slice(0, dwukropek) : w
      nazwy.push(zParametrami.split(';')[0]!)
    }
  }
  if (wZdarzeniu) bledy.push('RFC 5545 §3.6.1: BEGIN:VEVENT bez END:VEVENT')

  return bledy
}
