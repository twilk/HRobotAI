import {
  buildCanonicalSeed,
  assertCanonicalInvariants,
  weekCoverage,
  CANONICAL_WEEKS,
  ROLE,
  EMPLOYEE_COUNT,
} from './canonicalData.js'
import {
  generateSyntheticPesel,
  assertSyntheticPesel,
  isValidPeselChecksum,
} from './pesel.js'

describe('canonical synthetic seed', () => {
  it('is deterministic: two builds are byte-identical (frozen dataset)', () => {
    const a = buildCanonicalSeed()
    const b = buildCanonicalSeed()
    // pesel is a branded object; compare on the serializable projection.
    const norm = (s: ReturnType<typeof buildCanonicalSeed>) =>
      JSON.stringify({
        ...s,
        employees: s.employees.map((e) => ({ ...e, pesel: e.pesel.value })),
      })
    expect(norm(a)).toEqual(norm(b))
  })

  it('satisfies the frozen invariants (≥15 locations, 36 employees, scarce coordinators, unique ids)', () => {
    expect(() => assertCanonicalInvariants(buildCanonicalSeed())).not.toThrow()
  })

  it('has ≥15 locations and exactly 36 employees with distributed qualifications', () => {
    const seed = buildCanonicalSeed()
    expect(seed.locations.length).toBeGreaterThanOrEqual(15)
    expect(seed.employees).toHaveLength(EMPLOYEE_COUNT)
    const coordinators = seed.employees.filter((e) => e.qualifications.includes(ROLE.KOORDYNATOR))
    expect(coordinators).toHaveLength(3) // scarce role drives infeasibility
    // other roles are plentiful
    const withRole = (r: string) => seed.employees.filter((e) => e.qualifications.includes(r as never)).length
    expect(withRole(ROLE.KIEROWCA)).toBeGreaterThan(10)
    expect(withRole(ROLE.SERWISANT)).toBeGreaterThan(5)
    expect(withRole(ROLE.RECEPCJA)).toBeGreaterThan(1)
  })

  it('populates approved leaves that overlap a solve week', () => {
    const seed = buildCanonicalSeed()
    const approved = seed.leaves.filter((l) => l.status === 'APPROVED')
    expect(approved.length).toBeGreaterThan(0)
    // at least one approved leave overlaps the infeasible week
    const overlapsInfeasible = approved.some(
      (l) => l.startDate <= '2026-07-26' && l.endDate >= CANONICAL_WEEKS.infeasible.weekStart,
    )
    expect(overlapsInfeasible).toBe(true)
  })

  it('provides ≥2 weeks of demand: one FEASIBLE, one INFEASIBLE', () => {
    const seed = buildCanonicalSeed()
    const feasible = weekCoverage(seed, CANONICAL_WEEKS.feasible.weekStart)
    expect(feasible.feasible).toBe(true)
    expect(feasible.shortfalls).toHaveLength(0)

    const infeasible = weekCoverage(seed, CANONICAL_WEEKS.infeasible.weekStart)
    expect(infeasible.feasible).toBe(false)
    // the ONLY shortfall must be the scarce coordinator role (attributable infeasibility)
    expect(infeasible.shortfalls.length).toBeGreaterThan(0)
    for (const s of infeasible.shortfalls) expect(s.role).toBe(ROLE.KOORDYNATOR)
    // and it is caused by a genuine gap: only 1 coordinator available vs a required ≥2 that day
    const wed = infeasible.shortfalls.find((s) => s.date === '2026-07-22')
    expect(wed).toBeDefined()
    expect(wed!.available).toBe(1)
    expect(wed!.required).toBeGreaterThanOrEqual(2)
  })

  it('only APPROVED leave affects coverage (a PENDING coordinator leave does not bite)', () => {
    const seed = buildCanonicalSeed()
    // coordinator #0 has a PENDING leave that week; it must NOT be counted, leaving 1 available.
    const wed = weekCoverage(seed, CANONICAL_WEEKS.infeasible.weekStart).shortfalls.find(
      (s) => s.date === '2026-07-22',
    )
    expect(wed!.available).toBe(1)
  })
})

describe('synthetic PESEL + RODO guard', () => {
  it('generates valid-checksum, unique PESELs deterministically', () => {
    const first = Array.from({ length: EMPLOYEE_COUNT }, (_, i) => generateSyntheticPesel(i, i % 2 === 0 ? 'M' : 'F'))
    const again = Array.from({ length: EMPLOYEE_COUNT }, (_, i) => generateSyntheticPesel(i, i % 2 === 0 ? 'M' : 'F'))
    for (const p of first) expect(isValidPeselChecksum(p.value)).toBe(true)
    // deterministic
    expect(first.map((p) => p.value)).toEqual(again.map((p) => p.value))
    // unique
    expect(new Set(first.map((p) => p.value)).size).toBe(EMPLOYEE_COUNT)
  })

  it('hard-refuses any PESEL not produced by the synthetic generator (RODO §9)', () => {
    // a bare, checksum-valid string — could be a real PESEL pasted in — must be refused
    expect(isValidPeselChecksum('44051401359')).toBe(true) // valid FORMAT
    expect(() => assertSyntheticPesel('44051401359')).toThrow(/RODO refusal/)
    expect(() => assertSyntheticPesel({ value: '44051401359' })).toThrow(/RODO refusal/)
    expect(() => assertSyntheticPesel(undefined)).toThrow(/RODO refusal/)
  })

  it('accepts a branded synthetic PESEL and returns its digits', () => {
    const p = generateSyntheticPesel(7, 'F')
    expect(assertSyntheticPesel(p)).toBe(p.value)
  })
})
