import {
  ProblemInputSchema,
  SolveResultSchema,
  SolveStatus,
  type ProblemInput,
  type SolveResult,
} from './contract.js'

const sampleProblem: ProblemInput = {
  horizon: { weekStart: '2026-07-06' },
  locations: [{ id: 'loc-1', latLng: { lat: 52.23, lng: 21.01 } }],
  employees: [
    {
      id: 'emp-1',
      qualifications: ['KASJER'],
      etat: 1.0,
      homeLatLng: { lat: 52.24, lng: 21.02 },
      approvedLeaveDates: ['2026-07-08'],
      historyHours: 160,
    },
  ],
  demands: [
    {
      id: 'dem-1',
      locId: 'loc-1',
      date: '2026-07-06',
      start: '08:00',
      end: '16:00',
      role: 'KASJER',
      count: 1,
    },
  ],
  travelMatrix: [{ employeeId: 'emp-1', locId: 'loc-1', minutes: 12 }],
  weights: { d: 100, e: 10, g: 1 },
  solverConfig: { seed: 42, timeLimit: 30 },
}

const sampleResult: SolveResult = {
  status: SolveStatus.INFEASIBLE,
  assignments: [],
  metrics: { commuteTotal: 0, etatDeviation: 0, fairnessScore: 0 },
  unmet: [{ demandId: 'dem-1', reason: 'stub: no solver wired yet' }],
}

describe('grafik contract', () => {
  it('accepts a well-formed ProblemInput', () => {
    expect(ProblemInputSchema.parse(sampleProblem)).toEqual(sampleProblem)
  })

  it('accepts a well-formed SolveResult', () => {
    expect(SolveResultSchema.parse(sampleResult)).toEqual(sampleResult)
  })

  it('allows a null homeLatLng (unknown coordinate)', () => {
    const noHome = {
      ...sampleProblem,
      employees: [{ ...sampleProblem.employees[0]!, homeLatLng: null }],
    }
    expect(() => ProblemInputSchema.parse(noHome)).not.toThrow()
  })

  it('rejects an unknown status', () => {
    expect(() => SolveResultSchema.parse({ ...sampleResult, status: 'BOGUS' })).toThrow()
  })

  it('rejects a non-integer demand count', () => {
    const badCount = {
      ...sampleProblem,
      demands: [{ ...sampleProblem.demands[0]!, count: 1.5 }],
    }
    expect(() => ProblemInputSchema.parse(badCount)).toThrow()
  })

  // --- additive preference fields (backward-compat) ---------------------------------------------

  it('accepts a NEW ProblemInput carrying employee preferences + weight p', () => {
    const withPrefs: ProblemInput = {
      ...sampleProblem,
      employees: [
        {
          ...sampleProblem.employees[0]!,
          preferences: { preferredDaysOff: ['SAT', 'SUN'], preferredShiftStart: ['08:00'] },
        },
      ],
      weights: { ...sampleProblem.weights, p: 5 },
    }
    expect(ProblemInputSchema.parse(withPrefs)).toEqual(withPrefs)
  })

  it('accepts a NEW SolveResult carrying preferencesHonoredPct (0..1)', () => {
    const withHonored: SolveResult = {
      ...sampleResult,
      metrics: { ...sampleResult.metrics, preferencesHonoredPct: 0.75 },
    }
    expect(SolveResultSchema.parse(withHonored)).toEqual(withHonored)
  })

  it('BACKWARD-COMPAT: an OLD ProblemInput (no preferences, weights {d,e,g} without p) still validates', () => {
    // A preference-unaware peer emits exactly this shape — no `preferences`, no `p`.
    const oldProblem = {
      horizon: { weekStart: '2026-07-06' },
      locations: [{ id: 'loc-1', latLng: { lat: 52.23, lng: 21.01 } }],
      employees: [
        {
          id: 'emp-1',
          qualifications: ['KASJER'],
          etat: 1.0,
          homeLatLng: { lat: 52.24, lng: 21.02 },
          approvedLeaveDates: ['2026-07-08'],
          historyHours: 160,
        },
      ],
      demands: [
        { id: 'dem-1', locId: 'loc-1', date: '2026-07-06', start: '08:00', end: '16:00', role: 'KASJER', count: 1 },
      ],
      travelMatrix: [{ employeeId: 'emp-1', locId: 'loc-1', minutes: 12 }],
      weights: { d: 100, e: 10, g: 1 },
      solverConfig: { seed: 42, timeLimit: 30 },
    }
    const parsed = ProblemInputSchema.parse(oldProblem)
    expect(parsed.weights.p).toBeUndefined()
    expect(parsed.employees[0]!.preferences).toBeUndefined()
  })

  it('BACKWARD-COMPAT: an OLD SolveResult (no preferencesHonoredPct) still parses', () => {
    const oldResult = {
      status: SolveStatus.INFEASIBLE,
      assignments: [],
      metrics: { commuteTotal: 0, etatDeviation: 0, fairnessScore: 0 },
      unmet: [{ demandId: 'dem-1', reason: 'stub: no solver wired yet' }],
    }
    const parsed = SolveResultSchema.parse(oldResult)
    expect(parsed.metrics.preferencesHonoredPct).toBeUndefined()
  })
})
