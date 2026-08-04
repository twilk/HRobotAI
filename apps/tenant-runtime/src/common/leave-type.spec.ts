import { classifyLeaveType, drawsDownAnnualEntitlement, isUrlop, normalizeLeaveType } from './leave-type.js'

/**
 * The contract this file locks down is CROSS-MODULE: `analityk` and `strategic-brain` must give the
 * same answer for the same row. Before this module they did not — a `startsWith('URLOP')` Prisma
 * filter (case-sensitive on Postgres) versus a `toLowerCase().includes('urlop')` JS check.
 */
describe('leave-type classification', () => {
  describe('normalizeLeaveType', () => {
    it.each([
      ['URLOP_WYPOCZYNKOWY', 'urlop_wypoczynkowy'],
      ['urlop_wypoczynkowy', 'urlop_wypoczynkowy'],
      ['Urlop wypoczynkowy', 'urlop_wypoczynkowy'],
      ['URLOP-WYPOCZYNKOWY', 'urlop_wypoczynkowy'],
      ['  urlop   wypoczynkowy  ', 'urlop_wypoczynkowy'],
    ])('folds %j to %j', (input, expected) => {
      expect(normalizeLeaveType(input)).toBe(expected)
    })
  })

  describe('classifyLeaveType', () => {
    it('recognises the two entitlement-consuming holiday types', () => {
      expect(classifyLeaveType('URLOP_WYPOCZYNKOWY')).toBe('WYPOCZYNKOWY')
      expect(classifyLeaveType('URLOP_NA_ZADANIE')).toBe('WYPOCZYNKOWY')
    })

    it('is CASE-INSENSITIVE — the same row cannot count in one module and vanish in another', () => {
      expect(classifyLeaveType('urlop_wypoczynkowy')).toBe('WYPOCZYNKOWY')
      expect(classifyLeaveType('Urlop Wypoczynkowy')).toBe('WYPOCZYNKOWY')
    })

    it('keeps non-entitlement leave OUT of the holiday bucket (KP art. 154)', () => {
      for (const type of ['URLOP_BEZPŁATNY', 'URLOP_MACIERZYŃSKI', 'URLOP_RODZICIELSKI', 'URLOP_WYCHOWAWCZY', 'URLOP_OPIEKUŃCZY']) {
        expect(classifyLeaveType(type)).toBe('URLOP_INNY')
        expect(drawsDownAnnualEntitlement(type)).toBe(false)
        expect(isUrlop(type)).toBe(true)
      }
    })

    it('classifies sickness as L4, checked BEFORE holiday', () => {
      expect(classifyLeaveType('L4')).toBe('L4')
      expect(classifyLeaveType('CHOROBOWE')).toBe('L4')
      expect(classifyLeaveType('zwolnienie chorobowe')).toBe('L4')
      // A combined string must never be read as holiday just because it contains "urlop".
      expect(classifyLeaveType('urlop_chorobowy')).toBe('L4')
    })

    it('[W10] classifies ZWOLNIENIE_LEKARSKIE — the literal the product actually writes', () => {
      // This is not a hypothetical spelling: `ZWOLNIENIE_LEKARSKIE` is what the leave form and the
      // voice assistant both store, with 14 occurrences in production code. Until this marker
      // existed it fell through to NIEZNANY, so an employee on sick leave was NOT excluded from the
      // AI-Grafik scoring window — scored as if they had worked — and landed in the "unknown"
      // bucket in Analityk HR. (H1 triage, finding W10.)
      expect(classifyLeaveType('ZWOLNIENIE_LEKARSKIE')).toBe('L4')
      expect(classifyLeaveType('zwolnienie lekarskie')).toBe('L4')
      expect(classifyLeaveType('Zwolnienie-Lekarskie')).toBe('L4')
    })

    it('[W10] does NOT swallow a medical EXAMINATION into sickness', () => {
      // Deliberately narrow marker (`zwolnienie_lekarsk`, not `lekarsk`): occupational health exams
      // are paid working time under Polish labour law, not a sickness absence. A wider stem would
      // have misclassified them and quietly removed those hours from the roster.
      expect(classifyLeaveType('BADANIE_LEKARSKIE')).not.toBe('L4')
      expect(classifyLeaveType('badania lekarskie')).not.toBe('L4')
    })

    it('leaves an unrecognised type UNKNOWN rather than guessing it into a bucket', () => {
      expect(classifyLeaveType('OPIEKA_NAD_DZIECKIEM')).toBe('NIEZNANY')
      expect(classifyLeaveType('')).toBe('NIEZNANY')
      expect(drawsDownAnnualEntitlement('OPIEKA_NAD_DZIECKIEM')).toBe(false)
      expect(isUrlop('OPIEKA_NAD_DZIECKIEM')).toBe(false)
    })
  })

  describe('drawsDownAnnualEntitlement', () => {
    it('is true ONLY for the two holiday types — never for sickness', () => {
      expect(drawsDownAnnualEntitlement('URLOP_WYPOCZYNKOWY')).toBe(true)
      expect(drawsDownAnnualEntitlement('URLOP_NA_ZADANIE')).toBe(true)
      expect(drawsDownAnnualEntitlement('CHOROBOWE')).toBe(false)
      expect(drawsDownAnnualEntitlement('L4')).toBe(false)
    })
  })
})
