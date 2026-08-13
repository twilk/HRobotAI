import {
  buildLeaveCalendar,
  escapeIcsText,
  foldIcsLine,
  formatIcsDate,
  formatIcsTimestamp,
  icsLeaveUid,
  type IcsLeaveEvent,
} from './ics.util.js'

describe('ics.util — prymitywy RFC 5545', () => {
  it('formatIcsDate zwraca YYYYMMDD w UTC (kolumna @db.Date to północ UTC)', () => {
    expect(formatIcsDate(new Date('2026-08-03T00:00:00.000Z'))).toBe('20260803')
    expect(formatIcsDate(new Date('2026-12-31T00:00:00.000Z'))).toBe('20261231')
  })

  it('formatIcsTimestamp zwraca YYYYMMDDTHHMMSSZ (§3.3.5, forma UTC)', () => {
    expect(formatIcsTimestamp(new Date('2026-08-12T09:07:05.000Z'))).toBe('20260812T090705Z')
  })

  it('escapeIcsText chroni backslash, średnik, przecinek i nową linię (§3.3.11)', () => {
    expect(escapeIcsText('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne')
  })

  it('foldIcsLine nie rusza wiersza mieszczącego się w 75 oktetach', () => {
    const krotki = 'SUMMARY:Urlop'
    expect(foldIcsLine(krotki)).toBe(krotki)
  })

  it('foldIcsLine zwija po 75 oktetach, kontynuacja zaczyna się od pojedynczej spacji (§3.1)', () => {
    const dlugi = `X-TEST:${'a'.repeat(200)}`
    const wiersze = foldIcsLine(dlugi).split('\r\n')
    expect(wiersze.length).toBeGreaterThan(1)
    expect(Buffer.byteLength(wiersze[0]!, 'utf8')).toBe(75)
    for (const w of wiersze.slice(1)) {
      expect(w.startsWith(' ')).toBe(true)
      expect(Buffer.byteLength(w, 'utf8')).toBeLessThanOrEqual(75)
    }
    expect(wiersze.map((w, i) => (i === 0 ? w : w.slice(1))).join('')).toBe(dlugi)
  })

  it('foldIcsLine nie tnie w środku wielobajtowego znaku UTF-8 (polskie znaki)', () => {
    const dlugi = `X-TEST:${'ą'.repeat(120)}`
    const zlozony = foldIcsLine(dlugi)
      .split('\r\n')
      .map((w, i) => (i === 0 ? w : w.slice(1)))
      .join('')
    expect(zlozony).toBe(dlugi)
    expect(zlozony).not.toContain('�')
  })
})

const now = new Date('2026-08-12T09:07:05.000Z')

const zdarzenie = (over: Partial<IcsLeaveEvent> = {}): IcsLeaveEvent => ({
  uid: icsLeaveUid('11111111-1111-4111-8111-111111111111'),
  startDate: new Date('2026-08-03T00:00:00.000Z'),
  endDate: new Date('2026-08-07T00:00:00.000Z'),
  status: 'CONFIRMED',
  sequence: 1,
  lastModified: new Date('2026-08-01T12:00:00.000Z'),
  ...over,
})

describe('ics.util — buildLeaveCalendar', () => {
  it('opakowuje zdarzenia w VCALENDAR z VERSION/PRODID i kończy plik CRLF', () => {
    const ics = buildLeaveCalendar([zdarzenie()], now)
    const wiersze = ics.split('\r\n')
    expect(wiersze[0]).toBe('BEGIN:VCALENDAR')
    expect(wiersze).toContain('VERSION:2.0')
    expect(wiersze).toContain('PRODID:-//HRobot//Eksport ICS//PL')
    expect(wiersze).toContain('END:VCALENDAR')
    expect(ics.endsWith('\r\n')).toBe(true)
  })

  it('DTEND jest EKSKLUZYWNY: ostatni dzień urlopu + 1 (§3.6.1, wartość DATE)', () => {
    const wiersze = buildLeaveCalendar([zdarzenie()], now).split('\r\n')
    expect(wiersze).toContain('DTSTART;VALUE=DATE:20260803')
    expect(wiersze).toContain('DTEND;VALUE=DATE:20260808')
  })

  it('urlop jednodniowy ma DTEND równy dniu następnemu', () => {
    const jeden = zdarzenie({
      startDate: new Date('2026-08-03T00:00:00.000Z'),
      endDate: new Date('2026-08-03T00:00:00.000Z'),
    })
    const wiersze = buildLeaveCalendar([jeden], now).split('\r\n')
    expect(wiersze).toContain('DTSTART;VALUE=DATE:20260803')
    expect(wiersze).toContain('DTEND;VALUE=DATE:20260804')
  })

  it('tytuł jest neutralny i identyczny dla każdego zdarzenia — zero PII', () => {
    const ics = buildLeaveCalendar([zdarzenie(), zdarzenie({ status: 'CANCELLED', sequence: 2 })], now)
    const summary = ics.split('\r\n').filter((w) => w.startsWith('SUMMARY'))
    expect(summary).toEqual(['SUMMARY:Urlop', 'SUMMARY:Urlop'])
  })

  it('UID jest deterministyczny z id wniosku — nagrobek trafia w to samo zdarzenie', () => {
    expect(icsLeaveUid('abc')).toBe('urlop-abc@hrobot.local')
    const potwierdzony = buildLeaveCalendar([zdarzenie()], now)
    const anulowany = buildLeaveCalendar([zdarzenie({ status: 'CANCELLED', sequence: 2 })], now)
    const uid = (t: string) => t.split('\r\n').filter((w) => w.startsWith('UID:'))
    expect(uid(potwierdzony)).toEqual(uid(anulowany))
    expect(anulowany.split('\r\n')).toContain('STATUS:CANCELLED')
    expect(anulowany.split('\r\n')).toContain('SEQUENCE:2')
  })

  it('pusty kalendarz to poprawny VCALENDAR bez żadnego VEVENT', () => {
    const wiersze = buildLeaveCalendar([], now).split('\r\n')
    expect(wiersze).not.toContain('BEGIN:VEVENT')
    expect(wiersze[0]).toBe('BEGIN:VCALENDAR')
  })
})
