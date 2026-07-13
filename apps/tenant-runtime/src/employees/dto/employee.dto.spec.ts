import { validate } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { UpdateEmployeeDto } from './employee.dto.js'

/**
 * This DTO gates PII writes (PATCH /employees/:id), so it earns an explicit validation test even
 * though the repo usually skips DTO-level tests. Each case pins a real schema constraint.
 */
describe('UpdateEmployeeDto validation', () => {
  const errorsFor = (body: Record<string, unknown>): Promise<{ property: string }[]> =>
    validate(plainToInstance(UpdateEmployeeDto, body))

  it('accepts a fully-valid partial body', async () => {
    const errors = await errorsFor({
      firstName: 'Anna',
      position: 'Kasjer',
      employmentType: 'UMOWA_O_PRACE',
      unitId: '550e8400-e29b-41d4-a716-446655440000',
      etat: 0.5,
      qualifications: ['NURSE', 'DRIVER'],
      pesel: '44051401359',
    })
    expect(errors).toHaveLength(0)
  })

  it('accepts an empty body (all fields optional — PATCH semantics)', async () => {
    expect(await errorsFor({})).toHaveLength(0)
  })

  it('rejects a malformed PESEL', async () => {
    const errors = await errorsFor({ pesel: '123' })
    expect(errors.some((e) => e.property === 'pesel')).toBe(true)
  })

  it('rejects an out-of-range etat', async () => {
    const errors = await errorsFor({ etat: 2 })
    expect(errors.some((e) => e.property === 'etat')).toBe(true)
  })

  it('rejects an unknown employmentType', async () => {
    const errors = await errorsFor({ employmentType: 'FOO' })
    expect(errors.some((e) => e.property === 'employmentType')).toBe(true)
  })

  it('rejects a non-UUID unitId', async () => {
    const errors = await errorsFor({ unitId: 'not-a-uuid' })
    expect(errors.some((e) => e.property === 'unitId')).toBe(true)
  })
})
