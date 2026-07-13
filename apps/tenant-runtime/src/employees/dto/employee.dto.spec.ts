import { validate } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { CreateEmployeeDto, UpdateEmployeeDto } from './employee.dto.js'

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

describe('CreateEmployeeDto validation', () => {
  const validBody = {
    firstName: 'Anna',
    lastName: 'Kowalska',
    position: 'Kasjer',
    employmentType: 'UMOWA_O_PRACE',
    unitId: '550e8400-e29b-41d4-a716-446655440000',
    pesel: '44051401359',
    hiredAt: '2024-01-15',
  }
  const errorsFor = (body: Record<string, unknown>): Promise<{ property: string }[]> =>
    validate(plainToInstance(CreateEmployeeDto, body))

  it('accepts a fully-valid required-only body', async () => {
    expect(await errorsFor(validBody)).toHaveLength(0)
  })

  it('accepts a valid body with optional extras (etat, qualifications)', async () => {
    expect(
      await errorsFor({ ...validBody, etat: 0.5, qualifications: ['NURSE', 'DRIVER'] }),
    ).toHaveLength(0)
  })

  it('rejects a body missing pesel', async () => {
    const { pesel: _pesel, ...body } = validBody
    const errors = await errorsFor(body)
    expect(errors.some((e) => e.property === 'pesel')).toBe(true)
  })

  it('rejects a body missing unitId', async () => {
    const { unitId: _unitId, ...body } = validBody
    const errors = await errorsFor(body)
    expect(errors.some((e) => e.property === 'unitId')).toBe(true)
  })

  it('rejects a body missing hiredAt', async () => {
    const { hiredAt: _hiredAt, ...body } = validBody
    const errors = await errorsFor(body)
    expect(errors.some((e) => e.property === 'hiredAt')).toBe(true)
  })

  it('rejects an empty-string firstName', async () => {
    const errors = await errorsFor({ ...validBody, firstName: '' })
    expect(errors.some((e) => e.property === 'firstName')).toBe(true)
  })

  it('rejects a malformed PESEL', async () => {
    const errors = await errorsFor({ ...validBody, pesel: '123' })
    expect(errors.some((e) => e.property === 'pesel')).toBe(true)
  })

  it('rejects an out-of-range etat', async () => {
    const errors = await errorsFor({ ...validBody, etat: 2 })
    expect(errors.some((e) => e.property === 'etat')).toBe(true)
  })

  it('rejects an unknown employmentType', async () => {
    const errors = await errorsFor({ ...validBody, employmentType: 'FOO' })
    expect(errors.some((e) => e.property === 'employmentType')).toBe(true)
  })
})
