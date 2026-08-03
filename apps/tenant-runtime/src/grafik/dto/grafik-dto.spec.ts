import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { CreateShiftDemandDto, UpdateShiftDemandDto } from './shift-demand.dto.js'
import { SolveGrafikDto } from './solve.dto.js'

/**
 * Q2 — DTO guards for degenerate shift windows and a non-Monday horizon.
 *
 * Both used to sail through validation and produce a *plausible but wrong* schedule rather than an
 * error, which is the failure mode worth paying for a test.
 */

/** Return the failing property names for a payload, so assertions read as "which field complained". */
function failingProps<T extends object>(cls: new () => T, payload: Record<string, unknown>): string[] {
  const dto = plainToInstance(cls, payload)
  return validateSync(dto as object).map((e) => e.property)
}

function messagesFor<T extends object>(cls: new () => T, payload: Record<string, unknown>): string {
  const dto = plainToInstance(cls, payload)
  return validateSync(dto as object)
    .flatMap((e) => Object.values(e.constraints ?? {}))
    .join(' | ')
}

const validDemand = {
  lokalizacjaId: '3f1b6c2e-0f2a-4a1f-9a9e-6f3f1c2d4e5a',
  date: '2026-07-13',
  start: '06:00',
  end: '14:00',
  requiredRole: 'RECEPCJA',
  requiredCount: 2,
}

describe('CreateShiftDemandDto', () => {
  it('accepts a well-formed daytime demand', () => {
    expect(failingProps(CreateShiftDemandDto, validDemand)).toEqual([])
  })

  // The core Q2 case: end === start is silently read as "crosses midnight" by the solver
  // (_abs_window adds 24h), turning a zero-minute demand into a 24-hour shift.
  it('rejects a zero-length window (end === start)', () => {
    const props = failingProps(CreateShiftDemandDto, { ...validDemand, start: '08:00', end: '08:00' })
    expect(props).toContain('end')
    expect(messagesFor(CreateShiftDemandDto, { ...validDemand, start: '08:00', end: '08:00' })).toMatch(
      /zero-length window/i,
    )
  })

  // Equally important: do NOT over-validate. Night shifts are the business.
  it('ALLOWS an overnight window (end < start) — the solver wraps it past midnight', () => {
    expect(failingProps(CreateShiftDemandDto, { ...validDemand, start: '22:00', end: '06:00' })).toEqual([])
  })

  it('still rejects malformed times', () => {
    expect(failingProps(CreateShiftDemandDto, { ...validDemand, start: '25:00' })).toContain('start')
    expect(failingProps(CreateShiftDemandDto, { ...validDemand, end: '8:00' })).toContain('end')
  })

  it('rejects a syntactically valid but non-existent calendar date', () => {
    // The old `^\d{4}-\d{2}-\d{2}$` regex accepted these; they only blew up later in the solver.
    expect(failingProps(CreateShiftDemandDto, { ...validDemand, date: '2026-13-45' })).toContain('date')
    expect(failingProps(CreateShiftDemandDto, { ...validDemand, date: '2026-02-30' })).toContain('date')
  })

  it('accepts a real leap day', () => {
    // 2028 is a leap year — the round-trip guard must not reject a legitimate 29 February.
    expect(failingProps(CreateShiftDemandDto, { ...validDemand, date: '2028-02-29' })).toEqual([])
  })
})

describe('UpdateShiftDemandDto (PATCH)', () => {
  it('accepts a partial patch that touches neither time', () => {
    expect(failingProps(UpdateShiftDemandDto, { requiredCount: 3 })).toEqual([])
  })

  it('does not complain when only one side of the pair is supplied', () => {
    // With no `start` in the payload there is no pair to compare — the service merges against
    // the stored row, so a same-time patch is caught there, not by an unrelated 400 here.
    expect(failingProps(UpdateShiftDemandDto, { end: '14:00' })).toEqual([])
  })

  it('rejects a patch that sets both times to the same value', () => {
    expect(failingProps(UpdateShiftDemandDto, { start: '10:00', end: '10:00' })).toContain('end')
  })

  it('allows a patch to an overnight window', () => {
    expect(failingProps(UpdateShiftDemandDto, { start: '23:00', end: '07:00' })).toEqual([])
  })
})

describe('SolveGrafikDto.weekStart', () => {
  it('accepts a Monday', () => {
    // 2026-07-13 is a Monday.
    expect(failingProps(SolveGrafikDto, { weekStart: '2026-07-13' })).toEqual([])
  })

  it('rejects every other weekday', () => {
    // 2026-07-14 Tue … 2026-07-19 Sun. Mapped to pairs so a failure names the offending date.
    const days = ['2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19']
    const rejected = days.map((d) => [d, failingProps(SolveGrafikDto, { weekStart: d }).includes('weekStart')])
    expect(rejected).toEqual(days.map((d) => [d, true]))
  })

  it('explains why in the message', () => {
    expect(messagesFor(SolveGrafikDto, { weekStart: '2026-07-15' })).toMatch(/Monday/i)
  })

  it('rejects a non-existent date', () => {
    expect(failingProps(SolveGrafikDto, { weekStart: '2026-02-30' })).toContain('weekStart')
  })

  it('still accepts the optional scope fields alongside a Monday', () => {
    expect(
      failingProps(SolveGrafikDto, {
        weekStart: '2026-07-13',
        unitId: '3f1b6c2e-0f2a-4a1f-9a9e-6f3f1c2d4e5a',
        lokalizacjaIds: ['9a1b6c2e-0f2a-4a1f-9a9e-6f3f1c2d4e5b'],
      }),
    ).toEqual([])
  })
})
