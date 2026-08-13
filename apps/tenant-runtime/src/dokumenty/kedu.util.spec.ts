import { buildKeduModel, type KeduEmployeeInput } from './kedu.util'
import type { EwidencjaRow, Period } from './rcp.util'
import type { OvertimeSummary } from './overtime.util'
import { DEMO_CONFIG } from './dokumenty.config'

const utc = (iso: string) => new Date(iso)
const period: Period = { start: utc('2026-06-08T00:00:00Z'), end: utc('2026-06-14T00:00:00Z') }

const row = (date: string, workedMinutes: number | null, absence?: EwidencjaRow['absence']): EwidencjaRow => ({
  date,
  firstIn: null,
  lastOut: null,
  workedMinutes,
  breakMinutes: 0,
  ...(absence ? { absence } : {}),
  anomalie: [],
})

const emptySummary = (over: Partial<OvertimeSummary> = {}): OvertimeSummary => ({
  ot50Min: 0,
  ot100Min: 0,
  nightMin: 0,
  sundayMin: 0,
  holidayMin: 0,
  ot100NightSundayHolidayMin: 0,
  count: 0,
  daysWithoutRcp: 0,
  ...over,
})

const employees: KeduEmployeeInput[] = [
  { employeeId: 'e1', pesel: '90010112345', imie: 'Anna', nazwisko: 'Kowalska' },
  { employeeId: 'e2', pesel: '85050698765', imie: 'Piotr', nazwisko: 'Nowak' },
]

describe('kedu.util — buildKeduModel', () => {
  const ewidencja: Record<string, EwidencjaRow[]> = {
    e1: [row('2026-06-08', 480), row('2026-06-09', 600), row('2026-06-10', 480)],
    e2: [
      row('2026-06-08', 480),
      row('2026-06-09', null, 'URLOP_WYPOCZYNKOWY'),
      row('2026-06-10', null, 'URLOP_WYPOCZYNKOWY'),
      row('2026-06-11', null, 'URLOP_WYPOCZYNKOWY'),
    ],
  }
  const overtime: Record<string, OvertimeSummary> = {
    e1: emptySummary({ ot50Min: 120, count: 1 }),
    e2: emptySummary(),
  }

  const model = buildKeduModel(employees, period, ewidencja, overtime, DEMO_CONFIG)

  it('oznacza model jako demo + wersja poglądowa', () => {
    expect(model.demo).toBe(true)
    expect(model.wersjaSchematu).toMatch(/DEMO/i)
  })

  it('blok DRA: nagłówek płatnika + okres + liczba ubezpieczonych', () => {
    expect(model.dra.platnikNip).toBe(DEMO_CONFIG.platnik.nip)
    expect(model.dra.okresOd).toBe('2026-06-08')
    expect(model.dra.okresDo).toBe('2026-06-14')
    expect(model.dra.liczbaUbezpieczonych).toBe(2)
  })

  it('bloki RCA: jeden na pracownika, z PESEL i sumą minut/ nadgodzin', () => {
    expect(model.rca).toHaveLength(2)
    const rcaE1 = model.rca.find((b) => b.employeeId === 'e1')!
    expect(rcaE1.pesel).toBe('90010112345')
    expect(rcaE1.workedMinutes).toBe(1560) // 480+600+480
    expect(rcaE1.ot50Min).toBe(120)
  })

  it('bloki RSA: z absencji LeaveRequest (ciągły przedział urlopu)', () => {
    expect(model.rsa).toHaveLength(1)
    const rsa = model.rsa[0]!
    expect(rsa.employeeId).toBe('e2')
    expect(rsa.pesel).toBe('85050698765')
    expect(rsa.kod).toBe(DEMO_CONFIG.rsaKodPrzerwy.URLOP_WYPOCZYNKOWY)
    expect(rsa.od).toBe('2026-06-09')
    expect(rsa.do).toBe('2026-06-11')
  })

  it('brak absencji => brak bloków RSA', () => {
    const m = buildKeduModel(
      [employees[0]!],
      period,
      { e1: [row('2026-06-08', 480)] },
      { e1: emptySummary() },
      DEMO_CONFIG,
    )
    expect(m.rsa).toHaveLength(0)
  })

  it('dwa rozłączne przedziały absencji => dwa bloki RSA', () => {
    const m = buildKeduModel(
      [employees[1]!],
      period,
      {
        e2: [
          row('2026-06-08', null, 'URLOP_WYPOCZYNKOWY'),
          row('2026-06-09', 480),
          row('2026-06-11', null, 'ZWOLNIENIE_LEKARSKIE'),
        ],
      },
      { e2: emptySummary() },
      DEMO_CONFIG,
    )
    expect(m.rsa).toHaveLength(2)
    expect(m.rsa.map((b) => b.kod)).toEqual([
      DEMO_CONFIG.rsaKodPrzerwy.URLOP_WYPOCZYNKOWY,
      DEMO_CONFIG.rsaKodPrzerwy.ZWOLNIENIE_LEKARSKIE,
    ])
  })

  it('funkcja jest czysta — PESEL przychodzi argumentem (brak sięgania do bazy)', () => {
    // Sanity: PESEL w modelu pochodzi 1:1 z wejścia, nie jest generowany/pobierany.
    expect(model.rca.map((b) => b.pesel).sort()).toEqual(['85050698765', '90010112345'])
  })
})
