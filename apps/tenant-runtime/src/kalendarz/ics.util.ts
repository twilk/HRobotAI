/**
 * Generator pliku iCalendar (RFC 5545) dla urlopów. Funkcja czysta: żadnego Nesta, żadnej Prismy,
 * żadnego zegara systemowego — `now` wchodzi argumentem, żeby test mógł przypiąć DTSTAMP.
 *
 * ZERO PII (wymóg dok. j) §7): jedyny tekst, jaki trafia do pliku, to stała {@link ICS_EVENT_SUMMARY}
 * i identyfikator wniosku w UID. Ani imienia, ani nazwiska, ani rodzaju urlopu, ani uzasadnienia —
 * typ wniosku (`URLOP_WYPOCZYNKOWY` vs `ZWOLNIENIE_LEKARSKIE`) jest daną o zdrowiu i celowo NIE
 * wychodzi do kalendarza.
 */

/** Neutralny tytuł zdarzenia. Stała, nie parametr — parametr zaprosiłby PII z powrotem. */
export const ICS_EVENT_SUMMARY = 'Urlop'

/** Wartości STATUS dopuszczone przez RFC 5545 §3.8.1.11 dla komponentu VEVENT. */
export type IcsEventStatus = 'TENTATIVE' | 'CONFIRMED' | 'CANCELLED'

const CRLF = '\r\n'
/** RFC 5545 §3.1: wiersz nie może przekroczyć 75 OKTETÓW (nie znaków) plus CRLF. */
const MAX_LINE_OCTETS = 75

/** `YYYYMMDD` w UTC — kolumny `startDate`/`endDate` są `@db.Date`, czyli północ UTC. */
export function formatIcsDate(d: Date): string {
  const rok = String(d.getUTCFullYear()).padStart(4, '0')
  const miesiac = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dzien = String(d.getUTCDate()).padStart(2, '0')
  return `${rok}${miesiac}${dzien}`
}

/** `YYYYMMDDTHHMMSSZ` — forma UTC DATE-TIME z RFC 5545 §3.3.5. */
export function formatIcsTimestamp(d: Date): string {
  const g = String(d.getUTCHours()).padStart(2, '0')
  const m = String(d.getUTCMinutes()).padStart(2, '0')
  const s = String(d.getUTCSeconds()).padStart(2, '0')
  return `${formatIcsDate(d)}T${g}${m}${s}Z`
}

/** Ucieczka znaków dla wartości TEXT (RFC 5545 §3.3.11). Kolejność ma znaczenie: backslash pierwszy. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/**
 * Zwijanie wiersza (RFC 5545 §3.1). Liczymy OKTETY, nie znaki, i nigdy nie tniemy w środku
 * wielobajtowej sekwencji UTF-8 — inaczej polski znak rozpadłby się na dwa uszkodzone bajty po obu
 * stronach złamania. Pierwszy wiersz mieści 75 oktetów, każdy kolejny 74 (jeden oktet zjada wiodąca
 * spacja kontynuacji).
 */
export function foldIcsLine(line: string): string {
  const bajty = Buffer.from(line, 'utf8')
  if (bajty.length <= MAX_LINE_OCTETS) return line

  const czesci: string[] = []
  let offset = 0
  let limit = MAX_LINE_OCTETS
  while (offset < bajty.length) {
    let ile = Math.min(limit, bajty.length - offset)
    // Cofnij się do początku sekwencji UTF-8: 0b10xxxxxx to bajt kontynuacji.
    while (
      ile > 0 &&
      offset + ile < bajty.length &&
      (bajty[offset + ile]! & 0b1100_0000) === 0b1000_0000
    ) {
      ile -= 1
    }
    czesci.push(bajty.subarray(offset, offset + ile).toString('utf8'))
    offset += ile
    limit = MAX_LINE_OCTETS - 1
  }
  return czesci.join(`${CRLF} `)
}

/** Jedno zdarzenie kalendarza — projekcja wniosku urlopowego pozbawiona wszystkiego poza datami. */
export interface IcsLeaveEvent {
  uid: string
  /** Pierwszy dzień urlopu, włącznie. */
  startDate: Date
  /** Ostatni dzień urlopu, WŁĄCZNIE. DTEND liczymy z niego jako dzień następny. */
  endDate: Date
  status: IcsEventStatus
  /** RFC 5545 §3.8.7.4 — musi rosnąć przy każdej zmianie, inaczej klient zignoruje aktualizację. */
  sequence: number
  lastModified: Date
}

/**
 * Deterministyczny UID zdarzenia. Wyprowadzony wyłącznie z id wniosku, więc ten sam wniosek ma ten
 * sam UID przez całe życie — to jedyny powód, dla którego nagrobek `STATUS:CANCELLED` trafia w to
 * zdarzenie, które klient już ma, zamiast tworzyć drugie.
 */
export function icsLeaveUid(leaveId: string): string {
  return `urlop-${leaveId}@hrobot.local`
}

/** Dzień następny w UTC — DTEND zdarzenia całodniowego jest EKSKLUZYWNY (RFC 5545 §3.6.1). */
function nextDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1))
}

/** Buduje kompletny obiekt VCALENDAR. `now` wchodzi argumentem, żeby DTSTAMP dało się przypiąć w teście. */
export function buildLeaveCalendar(events: readonly IcsLeaveEvent[], now: Date): string {
  const dtstamp = formatIcsTimestamp(now)
  const wiersze: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//HRobot//Eksport ICS//PL',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText('Urlopy (eksport ICS)')}`,
  ]
  for (const e of events) {
    wiersze.push(
      'BEGIN:VEVENT',
      `UID:${escapeIcsText(e.uid)}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${formatIcsDate(e.startDate)}`,
      `DTEND;VALUE=DATE:${formatIcsDate(nextDayUtc(e.endDate))}`,
      `SUMMARY:${escapeIcsText(ICS_EVENT_SUMMARY)}`,
      `STATUS:${e.status}`,
      `SEQUENCE:${e.sequence}`,
      'TRANSP:OPAQUE',
      `LAST-MODIFIED:${formatIcsTimestamp(e.lastModified)}`,
      'END:VEVENT',
    )
  }
  wiersze.push('END:VCALENDAR')
  return wiersze.map(foldIcsLine).join(CRLF) + CRLF
}
