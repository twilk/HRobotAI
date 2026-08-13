import {
  warsawOffsetMinutes,
  warsawParts,
  pairEvents,
  dailyWorkedMinutes,
  aggregateEwidencja,
  type RcpEventLite,
} from './rcp.util'
import { DEMO_CONFIG } from './dokumenty.config'

const utc = (iso: string) => new Date(iso)
const ev = (type: RcpEventLite['type'], iso: string, employeeId = 'e1'): RcpEventLite => ({
  employeeId,
  occurredAt: utc(iso),
  type,
})

describe('rcp.util — strefa czasowa (Europe/Warsaw, DST jawnie)', () => {
  it('offset zimowy = +60 min (CET), letni = +120 min (CEST)', () => {
    expect(warsawOffsetMinutes(utc('2026-01-15T12:00:00Z'))).toBe(60)
    expect(warsawOffsetMinutes(utc('2026-07-15T12:00:00Z'))).toBe(120)
  })

  it('granica DST wiosna (ostatnia niedziela marca, przejście 01:00 UTC)', () => {
    // Reguła UE: ostatnia niedziela marca 2026 = 2026-03-29; zegar skacze 02:00→03:00 lokalnie.
    expect(warsawOffsetMinutes(utc('2026-03-29T00:30:00Z'))).toBe(60) // jeszcze CET
    expect(warsawOffsetMinutes(utc('2026-03-29T01:30:00Z'))).toBe(120) // już CEST
  })

  it('granica DST jesień (ostatnia niedziela października, przejście 01:00 UTC)', () => {
    expect(warsawOffsetMinutes(utc('2026-10-25T00:30:00Z'))).toBe(120) // jeszcze CEST
    expect(warsawOffsetMinutes(utc('2026-10-25T01:30:00Z'))).toBe(60) // już CET
  })

  it('warsawParts: przełom doby liczony w strefie lokalnej', () => {
    const p = warsawParts(utc('2026-01-15T23:30:00Z')) // +1h => 00:30 dnia następnego
    expect(p.dateKey).toBe('2026-01-16')
    expect(p.hour).toBe(0)
    expect(p.minute).toBe(30)
  })

  it('warsawParts: dayOfWeek 0=niedziela', () => {
    // 2026-06-07 to niedziela
    expect(warsawParts(utc('2026-06-07T10:00:00Z')).dayOfWeek).toBe(0)
  })
})

describe('rcp.util — pairEvents', () => {
  it('paruje WEJSCIE↔WYJSCIE i odejmuje przerwę (DOK-2)', () => {
    const sessions = pairEvents([
      ev('WEJSCIE', '2026-06-08T06:00:00Z'),
      ev('PRZERWA_START', '2026-06-08T10:00:00Z'),
      ev('PRZERWA_KONIEC', '2026-06-08T10:30:00Z'),
      ev('WYJSCIE', '2026-06-08T14:00:00Z'),
    ])
    expect(sessions).toHaveLength(1)
    const s = sessions[0]!
    expect(s.workedMinutes).toBe(450) // 8h span - 30m break
    expect(s.breakMinutes).toBe(30)
    expect(s.end).not.toBeNull()
    expect(s.anomalie).toEqual([])
  })

  it('sortuje nieposortowane wejście po occurredAt', () => {
    const sessions = pairEvents([
      ev('WYJSCIE', '2026-06-08T14:00:00Z'),
      ev('WEJSCIE', '2026-06-08T06:00:00Z'),
    ])
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.workedMinutes).toBe(480)
  })

  it('WEJSCIE bez WYJSCIE => sesja niesparowana (workedMinutes null, NIESPAROWANE)', () => {
    const sessions = pairEvents([ev('WEJSCIE', '2026-06-08T06:00:00Z')])
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.workedMinutes).toBeNull()
    expect(sessions[0]!.end).toBeNull()
    expect(sessions[0]!.anomalie).toContain('NIESPAROWANE')
  })

  it('WYJSCIE bez WEJSCIE => sesja niesparowana', () => {
    const sessions = pairEvents([ev('WYJSCIE', '2026-06-08T14:00:00Z')])
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.workedMinutes).toBeNull()
    expect(sessions[0]!.start).toBeNull()
    expect(sessions[0]!.anomalie).toContain('NIESPAROWANE')
  })

  it('przerwa bez końca liczona do WYJSCIE + flaga', () => {
    const sessions = pairEvents([
      ev('WEJSCIE', '2026-06-08T06:00:00Z'),
      ev('PRZERWA_START', '2026-06-08T13:00:00Z'),
      ev('WYJSCIE', '2026-06-08T14:00:00Z'),
    ])
    const s = sessions[0]!
    expect(s.breakMinutes).toBe(60) // przerwa domknięta na WYJSCIE
    expect(s.workedMinutes).toBe(420) // 480 - 60
    expect(s.anomalie).toContain('PRZERWA_NIEZAKONCZONA')
  })

  it('grupuje po pracowniku (dwóch pracowników, dwie sesje)', () => {
    const sessions = pairEvents([
      ev('WEJSCIE', '2026-06-08T06:00:00Z', 'e1'),
      ev('WYJSCIE', '2026-06-08T14:00:00Z', 'e1'),
      ev('WEJSCIE', '2026-06-08T07:00:00Z', 'e2'),
      ev('WYJSCIE', '2026-06-08T15:00:00Z', 'e2'),
    ])
    expect(sessions).toHaveLength(2)
    expect(sessions.every((s) => s.workedMinutes === 480)).toBe(true)
  })
})

describe('rcp.util — dailyWorkedMinutes', () => {
  it('sumuje minuty sesji przypisane do lokalnego dnia', () => {
    const sessions = pairEvents([
      ev('WEJSCIE', '2026-06-08T06:00:00Z'),
      ev('WYJSCIE', '2026-06-08T14:00:00Z'),
    ])
    expect(dailyWorkedMinutes(sessions, '2026-06-08', 'Europe/Warsaw')).toBe(480)
    expect(dailyWorkedMinutes(sessions, '2026-06-09', 'Europe/Warsaw')).toBe(0)
  })
})

describe('rcp.util — aggregateEwidencja (null-policy DOK-3)', () => {
  const period = { start: utc('2026-06-08T00:00:00Z'), end: utc('2026-06-08T00:00:00Z') } // Mon
  const shift = (dateKey: string, employeeId = 'e1') => ({ employeeId, date: utc(`${dateKey}T00:00:00Z`) })

  it('normalny dzień: workedMinutes policzone, brak anomalii', () => {
    const rows = aggregateEwidencja(
      [
        ev('WEJSCIE', '2026-06-08T06:00:00Z'),
        ev('PRZERWA_START', '2026-06-08T10:00:00Z'),
        ev('PRZERWA_KONIEC', '2026-06-08T10:30:00Z'),
        ev('WYJSCIE', '2026-06-08T14:00:00Z'),
      ],
      [],
      [shift('2026-06-08')],
      period,
      DEMO_CONFIG,
    )
    const day = rows.find((r) => r.date === '2026-06-08')!
    expect(day.workedMinutes).toBe(450)
    expect(day.breakMinutes).toBe(30)
    expect(day.anomalie).toEqual([])
    expect(day.absence).toBeUndefined()
  })

  it('grafik bez zdarzeń => workedMinutes NULL (nie 0) + BRAK_RCP', () => {
    const rows = aggregateEwidencja([], [], [shift('2026-06-08')], period, DEMO_CONFIG)
    const day = rows.find((r) => r.date === '2026-06-08')!
    expect(day.workedMinutes).toBeNull() // krytyczne: NIE 0
    expect(day.anomalie).toContain('BRAK_RCP')
  })

  it('wejście bez wyjścia => NIESPAROWANE, workedMinutes null', () => {
    const rows = aggregateEwidencja(
      [ev('WEJSCIE', '2026-06-08T06:00:00Z')],
      [],
      [shift('2026-06-08')],
      period,
      DEMO_CONFIG,
    )
    const day = rows.find((r) => r.date === '2026-06-08')!
    expect(day.anomalie).toContain('NIESPAROWANE')
    expect(day.workedMinutes).toBeNull()
  })

  it('urlop (LeaveRequest) rozpoznany strukturalnie => absence, brak BRAK_RCP', () => {
    const rows = aggregateEwidencja(
      [],
      [
        {
          employeeId: 'e1',
          startDate: utc('2026-06-08T00:00:00Z'),
          endDate: utc('2026-06-08T00:00:00Z'),
          type: 'URLOP_WYPOCZYNKOWY',
          status: 'APPROVED',
        },
      ],
      [shift('2026-06-08')],
      period,
      DEMO_CONFIG,
    )
    const day = rows.find((r) => r.date === '2026-06-08')!
    expect(day.absence).toBe('URLOP_WYPOCZYNKOWY')
    expect(day.anomalie).not.toContain('BRAK_RCP')
    expect(day.workedMinutes).toBeNull()
  })

  it('nieznany typ urlopu => kategoria INNE (fallback, nie zgadywanie)', () => {
    const rows = aggregateEwidencja(
      [],
      [
        {
          employeeId: 'e1',
          startDate: utc('2026-06-08T00:00:00Z'),
          endDate: utc('2026-06-08T00:00:00Z'),
          type: 'COS_NOWEGO_XYZ',
          status: 'APPROVED',
        },
      ],
      [],
      period,
      DEMO_CONFIG,
    )
    expect(rows.find((r) => r.date === '2026-06-08')!.absence).toBe('INNE')
  })

  it('zdarzenia RCP w dniu urlopu => RCP_W_NIEOBECNOSCI', () => {
    const rows = aggregateEwidencja(
      [ev('WEJSCIE', '2026-06-08T06:00:00Z'), ev('WYJSCIE', '2026-06-08T14:00:00Z')],
      [
        {
          employeeId: 'e1',
          startDate: utc('2026-06-08T00:00:00Z'),
          endDate: utc('2026-06-08T00:00:00Z'),
          type: 'URLOP_WYPOCZYNKOWY',
          status: 'APPROVED',
        },
      ],
      [],
      period,
      DEMO_CONFIG,
    )
    const day = rows.find((r) => r.date === '2026-06-08')!
    expect(day.anomalie).toContain('RCP_W_NIEOBECNOSCI')
    expect(day.absence).toBe('URLOP_WYPOCZYNKOWY')
  })

  it('urlop niezatwierdzony (PENDING) nie liczy się jako nieobecność', () => {
    const rows = aggregateEwidencja(
      [],
      [
        {
          employeeId: 'e1',
          startDate: utc('2026-06-08T00:00:00Z'),
          endDate: utc('2026-06-08T00:00:00Z'),
          type: 'URLOP_WYPOCZYNKOWY',
          status: 'PENDING',
        },
      ],
      [shift('2026-06-08')],
      period,
      DEMO_CONFIG,
    )
    const day = rows.find((r) => r.date === '2026-06-08')!
    expect(day.absence).toBeUndefined()
    expect(day.anomalie).toContain('BRAK_RCP') // grafik był, urlop niezatwierdzony => brak RCP
  })

  it('emituje wiersz dla każdego dnia okresu', () => {
    const rows = aggregateEwidencja(
      [],
      [],
      [],
      { start: utc('2026-06-08T00:00:00Z'), end: utc('2026-06-10T00:00:00Z') },
      DEMO_CONFIG,
    )
    expect(rows.map((r) => r.date)).toEqual(['2026-06-08', '2026-06-09', '2026-06-10'])
  })

  it('dzień zmiany czasu (DST wiosna) — minuty liczone poprawnie mimo skoku zegara', () => {
    // 2026-03-29: praca 04:00Z–12:00Z. Lokalnie CEST(+2): 06:00–14:00 = 8h realnie przepracowane.
    const rows = aggregateEwidencja(
      [ev('WEJSCIE', '2026-03-29T04:00:00Z'), ev('WYJSCIE', '2026-03-29T12:00:00Z')],
      [],
      [{ employeeId: 'e1', date: utc('2026-03-29T00:00:00Z') }],
      { start: utc('2026-03-29T00:00:00Z'), end: utc('2026-03-29T00:00:00Z') },
      DEMO_CONFIG,
    )
    const day = rows.find((r) => r.date === '2026-03-29')!
    expect(day.workedMinutes).toBe(480) // czas trwania niezależny od skoku zegara
  })
})
