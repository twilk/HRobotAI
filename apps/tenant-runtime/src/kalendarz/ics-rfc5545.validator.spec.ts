import { validateIcs } from './ics-rfc5545.validator.js'
import { buildLeaveCalendar, icsLeaveUid } from './ics.util.js'

const now = new Date('2026-08-12T09:07:05.000Z')

const poprawny = buildLeaveCalendar(
  [
    {
      uid: icsLeaveUid('11111111-1111-4111-8111-111111111111'),
      startDate: new Date('2026-08-03T00:00:00.000Z'),
      endDate: new Date('2026-08-07T00:00:00.000Z'),
      status: 'CONFIRMED',
      sequence: 1,
      lastModified: new Date('2026-08-01T12:00:00.000Z'),
    },
  ],
  now,
)

describe('ics-rfc5545.validator', () => {
  it('wyjście buildLeaveCalendar nie ma ani jednego naruszenia', () => {
    expect(validateIcs(poprawny)).toEqual([])
  })

  it('wykrywa zakończenia wierszy inne niż CRLF (§3.1)', () => {
    expect(validateIcs(poprawny.replace(/\r\n/g, '\n'))).toContainEqual(
      expect.stringContaining('§3.1'),
    )
  })

  it('wykrywa brak VERSION:2.0 (§3.7.4)', () => {
    expect(validateIcs(poprawny.replace('VERSION:2.0\r\n', ''))).toContainEqual(
      expect.stringContaining('§3.7.4'),
    )
  })

  it('wykrywa VEVENT bez UID (§3.6.1)', () => {
    expect(validateIcs(poprawny.replace(/UID:[^\r]*\r\n/, ''))).toContainEqual(
      expect.stringContaining('UID'),
    )
  })

  it('wykrywa niedomknięty BEGIN:VEVENT (§3.6.1)', () => {
    expect(validateIcs(poprawny.replace('END:VEVENT\r\n', ''))).toContainEqual(
      expect.stringContaining('END:VEVENT'),
    )
  })

  it('wykrywa wiersz dłuższy niż 75 oktetów (§3.1)', () => {
    const zly = poprawny.replace('BEGIN:VEVENT\r\n', `X-DLUGI:${'a'.repeat(200)}\r\nBEGIN:VEVENT\r\n`)
    expect(validateIcs(zly)).toContainEqual(expect.stringContaining('oktet'))
  })

  it('wykrywa pierwszy wiersz inny niż BEGIN:VCALENDAR (§3.4)', () => {
    expect(validateIcs(`X-SMIEC:1\r\n${poprawny}`)).toContainEqual(expect.stringContaining('§3.4'))
  })
})
