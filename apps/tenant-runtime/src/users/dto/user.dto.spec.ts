import { validate } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { InviteUserDto, RoleAssignmentDto } from './user.dto.js'

/**
 * This module's DTOs gate the highest-risk mutation surface in M2 (Keycloak/UserRole dual-write),
 * so — like `UpdateEmployeeDto` — they earn an explicit validation test even though the repo
 * usually skips DTO-level tests.
 */
describe('InviteUserDto validation', () => {
  const errorsFor = (body: Record<string, unknown>): Promise<{ property: string }[]> =>
    validate(plainToInstance(InviteUserDto, body))

  it('accepts a valid GLOBAL invite (no unitId)', async () => {
    expect(await errorsFor({ email: 'new@acme.com', role: 'HR' })).toHaveLength(0)
  })

  it('accepts a valid unit-scoped invite', async () => {
    const errors = await errorsFor({ email: 'new@acme.com', role: 'MANAGER', unitId: '550e8400-e29b-41d4-a716-446655440000' })
    expect(errors).toHaveLength(0)
  })

  it('rejects a malformed email', async () => {
    const errors = await errorsFor({ email: 'not-an-email', role: 'HR' })
    expect(errors.some((e) => e.property === 'email')).toBe(true)
  })

  it('rejects an unknown role', async () => {
    const errors = await errorsFor({ email: 'new@acme.com', role: 'SUPERUSER' })
    expect(errors.some((e) => e.property === 'role')).toBe(true)
  })

  it('rejects a non-UUID unitId', async () => {
    const errors = await errorsFor({ email: 'new@acme.com', role: 'MANAGER', unitId: 'not-a-uuid' })
    expect(errors.some((e) => e.property === 'unitId')).toBe(true)
  })
})

describe('RoleAssignmentDto validation', () => {
  const errorsFor = (body: Record<string, unknown>): Promise<{ property: string }[]> =>
    validate(plainToInstance(RoleAssignmentDto, body))

  it('accepts a GLOBAL role assignment (no unitId)', async () => {
    expect(await errorsFor({ role: 'ADMIN_KLIENTA' })).toHaveLength(0)
  })

  it('accepts a unit-scoped role assignment', async () => {
    const errors = await errorsFor({ role: 'MANAGER', unitId: '550e8400-e29b-41d4-a716-446655440000' })
    expect(errors).toHaveLength(0)
  })

  it('rejects a missing role', async () => {
    const errors = await errorsFor({})
    expect(errors.some((e) => e.property === 'role')).toBe(true)
  })

  it('rejects an unknown role', async () => {
    const errors = await errorsFor({ role: 'SUPERUSER' })
    expect(errors.some((e) => e.property === 'role')).toBe(true)
  })
})
