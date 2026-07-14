import {
  medianCycleMinutes,
  defectRate,
  slaHitRate,
  compositeScore,
  developmentSlope,
  confidence,
  retentionSignal,
  normalizeToPeerGroup,
} from './scoring.util'

describe('scoring.util', () => {
  describe('medianCycleMinutes', () => {
    it('null gdy brak ukończonych', () => {
      expect(medianCycleMinutes([])).toBeNull()
    })

    it('mediana dla nieparzystej liczby (kolejność wejścia nieposortowana)', () => {
      expect(medianCycleMinutes([{ cycleMinutes: 10 }, { cycleMinutes: 30 }, { cycleMinutes: 20 }])).toBe(20)
    })

    it('mediana dla parzystej liczby = średnia dwóch środkowych', () => {
      expect(
        medianCycleMinutes([{ cycleMinutes: 10 }, { cycleMinutes: 20 }, { cycleMinutes: 30 }, { cycleMinutes: 40 }]),
      ).toBe(25)
    })

    it('jeden element -> ten element', () => {
      expect(medianCycleMinutes([{ cycleMinutes: 42 }])).toBe(42)
    })
  })

  describe('defectRate', () => {
    it('complaints/DONE, null gdy denominator < 1', () => {
      expect(defectRate(0, 3)).not.toBeNull()
      // NOTE: plan Task 2 Step 1 verbatim example used `defectRate(10, 2) toBeCloseTo(0.2)`, which
      // is inconsistent with the (complaintCount, completedCount) signature given in this task's
      // instructions (10 complaints / 2 completed = 5, not 0.2 — that value only works out under
      // the OPPOSITE (completedCount, complaintCount) order from spec §4). Resolved in favor of the
      // task-instructions signature (also what §4's prose "complaints/completed" implies) and kept
      // the same intended ratio (0.2) with values that are unambiguous under either reading.
      expect(defectRate(10, 50)).toBeCloseTo(0.2)
    })

    it('null gdy completedCount = 0 (min. denominator, M7)', () => {
      expect(defectRate(0, 0)).toBeNull()
    })

    it('null gdy completedCount ujemny (nie powinno wystąpić, ale broni się)', () => {
      expect(defectRate(1, -1)).toBeNull()
    })

    it('0 skarg / N ukończonych = 0 (nie null)', () => {
      expect(defectRate(0, 5)).toBe(0)
    })
  })

  describe('slaHitRate', () => {
    it('null gdy brak ukończonych', () => {
      expect(slaHitRate([], 30)).toBeNull()
    })

    it('frakcja w SLA — dokładnie na granicy liczy się jako trafienie (<=)', () => {
      expect(
        slaHitRate(
          [{ cycleMinutes: 30 }, { cycleMinutes: 31 }, { cycleMinutes: 10 }, { cycleMinutes: 15 }],
          30,
        ),
      ).toBeCloseTo(0.75)
    })

    it('wszystkie w SLA -> 1', () => {
      expect(slaHitRate([{ cycleMinutes: 5 }, { cycleMinutes: 10 }], 30)).toBe(1)
    })

    it('żadne w SLA -> 0', () => {
      expect(slaHitRate([{ cycleMinutes: 45 }, { cycleMinutes: 60 }], 30)).toBe(0)
    })
  })

  describe('compositeScore', () => {
    it('renormalizuje wagi po obecnych wymiarach (M8)', () => {
      // brak quality → waga rozkłada się na obecne
      const s = compositeScore(
        { performance: 80, timeliness: 60, quality: null, development: 40 },
        { performance: 0.3, timeliness: 0.25, quality: 0.25, development: 0.2 },
      )
      expect(s).not.toBeNull()
      // renormalized weights: performance 0.3/0.75, timeliness 0.25/0.75, development 0.2/0.75
      const expected = (80 * 0.3 + 60 * 0.25 + 40 * 0.2) / 0.75
      expect(s!).toBeCloseTo(expected)
    })

    it('null gdy < 2 wymiary obecne (M8)', () => {
      expect(
        compositeScore(
          { performance: 80, timeliness: null, quality: null, development: null },
          { performance: 0.3, timeliness: 0.25, quality: 0.25, development: 0.2 },
        ),
      ).toBeNull()
    })

    it('null gdy 0 wymiarów obecnych', () => {
      expect(
        compositeScore(
          { performance: null, timeliness: null, quality: null, development: null },
          { performance: 0.3, timeliness: 0.25, quality: 0.25, development: 0.2 },
        ),
      ).toBeNull()
    })

    it('wszystkie 4 wymiary obecne -> ważona średnia bez renormalizacji', () => {
      const s = compositeScore(
        { performance: 100, timeliness: 100, quality: 0, development: 0 },
        { performance: 0.3, timeliness: 0.25, quality: 0.25, development: 0.2 },
      )
      expect(s!).toBeCloseTo(55)
    })

    it('dokładnie 2 wymiary obecne -> renormalizacja do sumy=1', () => {
      const s = compositeScore(
        { performance: 100, timeliness: null, quality: null, development: 0 },
        { performance: 0.3, timeliness: 0.25, quality: 0.25, development: 0.2 },
      )
      // weights performance 0.3/0.5, development 0.2/0.5 -> 0.6*100 + 0.4*0 = 60
      expect(s!).toBeCloseTo(60)
    })

    it('deterministyczne — to samo wejście, ten sam wynik przy wielokrotnym wywołaniu', () => {
      const dims = { performance: 70, timeliness: 55, quality: null, development: 90 }
      const weights = { performance: 0.3, timeliness: 0.25, quality: 0.25, development: 0.2 }
      const first = compositeScore(dims, weights)
      const second = compositeScore(dims, weights)
      expect(first).toBe(second)
    })

    it('waga sumaryczna obecnych wymiarów = 0 -> null (nie da się renormalizować)', () => {
      const s = compositeScore(
        { performance: 80, timeliness: 60, quality: null, development: null },
        { performance: 0, timeliness: 0, quality: 0.5, development: 0.5 },
      )
      expect(s).toBeNull()
    })
  })

  describe('developmentSlope', () => {
    it('null gdy < minValidWindows (M9)', () => {
      expect(developmentSlope([{ t: 0, score: 40 }, { t: 1, score: 50 }], 3)).toBeNull()
    })

    it('dodatni dla rosnącej serii >=3', () => {
      const slope = developmentSlope([{ t: 0, score: 40 }, { t: 1, score: 50 }, { t: 2, score: 60 }], 3)
      expect(slope!).toBeGreaterThan(0)
    })

    it('ujemny dla malejącej serii >=3', () => {
      const slope = developmentSlope([{ t: 0, score: 60 }, { t: 1, score: 50 }, { t: 2, score: 40 }], 3)
      expect(slope!).toBeLessThan(0)
    })

    it('~0 dla płaskiej serii', () => {
      const slope = developmentSlope([{ t: 0, score: 50 }, { t: 1, score: 50 }, { t: 2, score: 50 }], 3)
      expect(slope!).toBeCloseTo(0)
    })

    it('dokładnie minValidWindows elementów -> liczy (nie null)', () => {
      const slope = developmentSlope([{ t: 0, score: 10 }, { t: 1, score: 20 }, { t: 2, score: 30 }], 3)
      expect(slope).not.toBeNull()
    })
  })

  describe('confidence', () => {
    it('mieści się w [0,1]', () => {
      const c = confidence(5, 20, 30)
      expect(c).toBeGreaterThanOrEqual(0)
      expect(c).toBeLessThanOrEqual(1)
    })

    it('mała próbka N -> niska pewność, nawet przy długim stażu', () => {
      const c = confidence(0, 365, 30)
      expect(c).toBeLessThan(0.3)
    })

    it('mały staż -> niska pewność, nawet przy dużym N', () => {
      const c = confidence(50, 1, 30)
      expect(c).toBeLessThan(0.3)
    })

    it('duża próbka + długi staż -> wysoka pewność (bliska 1)', () => {
      const c = confidence(50, 365, 30)
      expect(c).toBeGreaterThan(0.9)
    })

    it('rośnie monotonicznie z N przy stałym stażu', () => {
      const low = confidence(1, 100, 30)
      const high = confidence(20, 100, 30)
      expect(high).toBeGreaterThan(low)
    })

    it('brak ujemnych wyników dla ujemnych/zerowych wejść', () => {
      expect(confidence(0, 0, 30)).toBe(0)
    })
  })

  describe('retentionSignal', () => {
    const cfg = { minSlopeForGrowth: 0.5, confidenceMin: 0.5 }

    it('INWESTOWAC dla słaby-rosnący', () => {
      expect(retentionSignal(35, 5, 0.9, cfg)).toBe('INWESTOWAC')
    })

    it('RYZYKO dla dobry-spadający', () => {
      expect(retentionSignal(85, -5, 0.9, cfg)).toBe('RYZYKO')
    })

    it('OBSERWOWAC dla null-trend (M9) — nigdy RYZYKO', () => {
      expect(retentionSignal(50, null, 0.9, cfg)).toBe('OBSERWOWAC')
      // also true when score is high — null-trend still never RYZYKO
      expect(retentionSignal(90, null, 0.9, cfg)).toBe('OBSERWOWAC')
      expect(retentionSignal(90, null, 0.9, cfg)).not.toBe('RYZYKO')
    })

    it('RYZYKO dla słaby-płaski (niski score, slope nie przekracza minSlopeForGrowth)', () => {
      expect(retentionSignal(30, 0, 0.9, cfg)).toBe('RYZYKO')
    })

    it('UTRZYMAC dla wysoki score, slope nieujemny', () => {
      expect(retentionSignal(85, 0, 0.9, cfg)).toBe('UTRZYMAC')
      expect(retentionSignal(85, 2, 0.9, cfg)).toBe('UTRZYMAC')
    })

    it('niska pewność -> OBSERWOWAC nawet gdy wygląda jak INWESTOWAC/RYZYKO', () => {
      expect(retentionSignal(35, 5, 0.2, cfg)).toBe('OBSERWOWAC')
      expect(retentionSignal(85, -5, 0.2, cfg)).toBe('OBSERWOWAC')
    })

    it('slope dokładnie na progu minSlopeForGrowth nie liczy się jako rosnący (ścisła nierówność)', () => {
      expect(retentionSignal(35, 0.5, 0.9, cfg)).toBe('RYZYKO')
    })

    it('deterministyczne dla tych samych wejść', () => {
      expect(retentionSignal(35, 5, 0.9, cfg)).toBe(retentionSignal(35, 5, 0.9, cfg))
    })
  })

  describe('normalizeToPeerGroup (M10)', () => {
    const cfg = { minPeerGroupSize: 5 }

    it('meaningful:false gdy grupa < minPeerGroupSize (nie ufamy normalizacji)', () => {
      const r = normalizeToPeerGroup(50, [10, 50, 90], cfg) // n=3 < 5
      expect(r.meaningful).toBe(false)
      // wartość wciąż zwrócona (do ewentualnego wyświetlenia „orientacyjnie"), ale nie-wiarygodna
      expect(r.value).not.toBeNull()
    })

    it('single-element -> not meaningful', () => {
      const r = normalizeToPeerGroup(42, [42], cfg)
      expect(r.meaningful).toBe(false)
    })

    it('pusta grupa -> value:null, meaningful:false', () => {
      const r = normalizeToPeerGroup(42, [], cfg)
      expect(r.value).toBeNull()
      expect(r.meaningful).toBe(false)
    })

    it('sensowny percentyl dla grupy >= min: wyższa wartość -> wyższy percentyl', () => {
      const peers = [10, 20, 30, 40, 50] // n=5 >= min
      const top = normalizeToPeerGroup(50, peers, cfg)
      const bottom = normalizeToPeerGroup(10, peers, cfg)
      expect(top.meaningful).toBe(true)
      expect(bottom.meaningful).toBe(true)
      expect(top.value!).toBeGreaterThan(bottom.value!)
      // wynik w zakresie 0..100
      expect(top.value!).toBeLessThanOrEqual(100)
      expect(bottom.value!).toBeGreaterThanOrEqual(0)
    })

    it('mediana grupy -> ~środek skali (mid-rank percentyl)', () => {
      const peers = [10, 20, 30, 40, 50]
      expect(normalizeToPeerGroup(30, peers, cfg).value!).toBeCloseTo(50)
    })

    it('wszyscy równi w dużej grupie -> 50 i meaningful', () => {
      const peers = [50, 50, 50, 50, 50]
      const r = normalizeToPeerGroup(50, peers, cfg)
      expect(r.value!).toBeCloseTo(50)
      expect(r.meaningful).toBe(true)
    })

    it('deterministyczne dla tych samych wejść', () => {
      const peers = [1, 2, 3, 4, 5, 6]
      expect(normalizeToPeerGroup(4, peers, cfg)).toEqual(normalizeToPeerGroup(4, peers, cfg))
    })
  })
})
