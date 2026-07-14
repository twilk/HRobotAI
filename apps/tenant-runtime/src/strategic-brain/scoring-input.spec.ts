import { buildScoringInput } from './scoring-input'

/**
 * [M11] Fairness = ALLOWLIST, not denylist. A denylist ("no field named wiek/plec") only proves a
 * NAME is absent, not that a proxy for a protected characteristic never enters the scorer. These
 * tests prove the enforceable guarantee: `buildScoringInput` accepts ONLY the explicit allowlist
 * of operational-metric keys and hard-errors on ANY unexpected key — known-bad name or not.
 */
describe('scoring-input', () => {
  describe('buildScoringInput', () => {
    it('rzuca gdy do inputu wejdzie klucz spoza allowlisty (M11 proxy-guard)', () => {
      expect(() => buildScoringInput({ throughput: 5, wiek: 40 } as any)).toThrow(/unexpected key/i)
    })

    it('rzuca dla dowolnego nieoczekiwanego klucza, nie tylko znanych złych nazw', () => {
      // proxy for a protected characteristic — not a "bad name" the guard could special-case
      expect(() => buildScoringInput({ throughput: 5, completedCount: 3, homeLat: 52.2 } as any)).toThrow(
        /unexpected key/i,
      )
      expect(() => buildScoringInput({ plec: 'K' } as any)).toThrow(/unexpected key/i)
      expect(() => buildScoringInput({ someTotallyRandomField: 'x' } as any)).toThrow(/unexpected key/i)
    })

    it('przepuszcza tylko dozwolone metryki operacyjne (pełny zestaw)', () => {
      const hiredAt = new Date('2025-01-01')
      const input = buildScoringInput({
        throughput: 5,
        completedCount: 5,
        complaintCount: 1,
        cycleMinutes: 42,
        slaHits: 4,
        peerGroupKey: 'k',
        hiredAt,
      })
      expect(Object.keys(input).sort()).toEqual(
        ['complaintCount', 'completedCount', 'cycleMinutes', 'hiredAt', 'peerGroupKey', 'slaHits', 'throughput'].sort(),
      )
      expect(input).toEqual({
        throughput: 5,
        completedCount: 5,
        complaintCount: 1,
        cycleMinutes: 42,
        slaHits: 4,
        peerGroupKey: 'k',
        hiredAt,
      })
    })

    it('brakujące dozwolone klucze są OK — guard odrzuca nieoczekiwane, nie wymaga kompletu', () => {
      const input = buildScoringInput({ throughput: 5, completedCount: 3 })
      expect(Object.keys(input).sort()).toEqual(['completedCount', 'throughput'])
      expect(input).toEqual({ throughput: 5, completedCount: 3 })
    })

    it('pusty obiekt -> pusty wynik (brak kluczy nie jest błędem)', () => {
      expect(buildScoringInput({})).toEqual({})
    })
  })
})
