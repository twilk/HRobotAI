import { escapeIcsText, foldIcsLine, formatIcsDate, formatIcsTimestamp } from './ics.util.js'

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
