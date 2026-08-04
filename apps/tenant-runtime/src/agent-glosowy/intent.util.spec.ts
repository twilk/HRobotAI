import { parseIntent, CONFIDENCE_THRESHOLD } from './intent.util.js'

/** Wednesday, 2026-07-29 (UTC midnight) — the fixed "today" every case reasons from. */
const TODAY = new Date('2026-07-29T00:00:00.000Z')

describe('parseIntent — closed PL command set (K1 urlop / K2 L4 / K3 mój grafik)', () => {
  describe('K1 — URLOP (leave request, write)', () => {
    it('parses "chcę wziąć urlop od piątku do poniedziałku" into a weekday range', () => {
      const r = parseIntent('chcę wziąć urlop od piątku do poniedziałku', TODAY)
      expect(r.intent).toBe('URLOP')
      expect(r.entities.dateFrom).toBe('2026-07-31') // next Friday on/after today
      expect(r.entities.dateTo).toBe('2026-08-03') // Monday after that Friday
      expect(r.entities.type).toBe('URLOP_WYPOCZYNKOWY')
      expect(r.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD)
    })

    it('parses a month-name numeric range "chcę urlop od 1 do 5 sierpnia"', () => {
      const r = parseIntent('chcę urlop od 1 do 5 sierpnia', TODAY)
      expect(r.intent).toBe('URLOP')
      expect(r.entities.dateFrom).toBe('2026-08-01')
      expect(r.entities.dateTo).toBe('2026-08-05')
    })
  })

  describe('K2 — L4 (sick leave, write)', () => {
    it('parses "zgłoś L4 na dziś" as a single-day sick leave', () => {
      const r = parseIntent('zgłoś L4 na dziś', TODAY)
      expect(r.intent).toBe('L4')
      expect(r.entities.dateFrom).toBe('2026-07-29')
      expect(r.entities.dateTo).toBe('2026-07-29')
      expect(r.entities.type).toBe('ZWOLNIENIE_LEKARSKIE')
      expect(r.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD)
    })

    it('"jestem na zwolnieniu od jutra" is L4 (sick keyword wins over any leave phrasing)', () => {
      const r = parseIntent('jestem na zwolnieniu od jutra', TODAY)
      expect(r.intent).toBe('L4')
      expect(r.entities.dateFrom).toBe('2026-07-30')
    })
  })

  describe('K3 — MOJ_GRAFIK (schedule read)', () => {
    it('parses "jaki mam grafik jutro"', () => {
      const r = parseIntent('jaki mam grafik jutro', TODAY)
      expect(r.intent).toBe('MOJ_GRAFIK')
      expect(r.entities.dateFrom).toBe('2026-07-30')
      expect(r.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD)
    })

    it('defaults a dateless "pokaż mój grafik" to today (read is safe to default)', () => {
      const r = parseIntent('pokaż mój grafik', TODAY)
      expect(r.intent).toBe('MOJ_GRAFIK')
      expect(r.entities.dateFrom).toBe('2026-07-29')
      expect(r.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD)
    })
  })

  describe('SALDO_URLOPU (leave balance, read)', () => {
    it('parses "ile mam dni urlopu" with HIGH confidence and no date needed', () => {
      const r = parseIntent('ile mam dni urlopu', TODAY)
      expect(r.intent).toBe('SALDO_URLOPU')
      expect(r.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD)
    })

    it('parses "jakie mam saldo urlopowe"', () => {
      const r = parseIntent('jakie mam saldo urlopowe', TODAY)
      expect(r.intent).toBe('SALDO_URLOPU')
    })

    it('does not mistake "chcę wziąć urlop" (no saldo/ile marker) for SALDO_URLOPU', () => {
      const r = parseIntent('chcę wziąć urlop', TODAY)
      expect(r.intent).toBe('URLOP')
    })
  })

  describe('STATUS_WNIOSKU (leave request status, read)', () => {
    it('parses "co z moim wnioskiem" with HIGH confidence', () => {
      const r = parseIntent('co z moim wnioskiem', TODAY)
      expect(r.intent).toBe('STATUS_WNIOSKU')
      expect(r.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD)
    })

    it('parses "jaki jest status mojego wniosku"', () => {
      const r = parseIntent('jaki jest status mojego wniosku', TODAY)
      expect(r.intent).toBe('STATUS_WNIOSKU')
    })
  })

  describe('ambiguous / out-of-set → NIEZNANE or low confidence (never guess-execute)', () => {
    it('returns NIEZNANE with sub-threshold confidence for an utterance outside the set', () => {
      const r = parseIntent('jaka jest dzisiaj pogoda w Warszawie', TODAY)
      expect(r.intent).toBe('NIEZNANE')
      expect(r.confidence).toBeLessThan(CONFIDENCE_THRESHOLD)
    })

    it('lowers confidence below threshold for a write intent with no parseable date', () => {
      const r = parseIntent('chcę wziąć urlop', TODAY)
      expect(r.intent).toBe('URLOP')
      expect(r.entities.dateFrom).toBeUndefined()
      expect(r.confidence).toBeLessThan(CONFIDENCE_THRESHOLD)
    })
  })

  describe('PL relative/weekday/month date normalization', () => {
    it('resolves weekday names to the next occurrence on/after today', () => {
      expect(parseIntent('jaki mam grafik w piątek', TODAY).entities.dateFrom).toBe('2026-07-31')
      // today itself is Wednesday → środa resolves to today, not next week
      expect(parseIntent('jaki mam grafik w środę', TODAY).entities.dateFrom).toBe('2026-07-29')
    })

    it('resolves dziś / jutro / pojutrze relative to the passed-in today', () => {
      expect(parseIntent('grafik dziś', TODAY).entities.dateFrom).toBe('2026-07-29')
      expect(parseIntent('grafik jutro', TODAY).entities.dateFrom).toBe('2026-07-30')
      expect(parseIntent('grafik pojutrze', TODAY).entities.dateFrom).toBe('2026-07-31')
    })

    it('resolves an ISO date verbatim', () => {
      const r = parseIntent('chcę urlop 2026-09-15', TODAY)
      expect(r.entities.dateFrom).toBe('2026-09-15')
      expect(r.entities.dateTo).toBe('2026-09-15')
    })

    it('is deterministic — same input+today yields identical output', () => {
      const a = parseIntent('zgłoś L4 od poniedziałku do piątku', TODAY)
      const b = parseIntent('zgłoś L4 od poniedziałku do piątku', TODAY)
      expect(a).toEqual(b)
    })
  })
})
