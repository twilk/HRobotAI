import { describe, expect, it } from 'vitest'
import {
  roleLabel,
  ROLES,
  isOnlyActiveGlobalAdmin,
  canManageUser,
  humanizeUsersError,
  buildInviteBody,
  EMPTY_INVITE_FORM,
  type TenantUser,
  type InviteFormState,
} from './uzytkownicy'

// vitest.config.ts runs lib/**/*.test.ts under environment: 'node'. No network, no PII: everything
// exercised here is a pure function over already-fetched roster shapes or controlled-form state.

describe('roleLabel', () => {
  it('maps every role to a distinct Polish label', () => {
    expect(roleLabel('PRACOWNIK')).toBe('Pracownik')
    expect(roleLabel('MANAGER')).toBe('Menedżer')
    expect(roleLabel('HR')).toBe('HR')
    expect(roleLabel('ADMIN_KLIENTA')).toBe('Admin klienta')
  })

  it('covers all four enum values with unique labels', () => {
    expect(ROLES).toHaveLength(4)
    expect(new Set(ROLES.map(roleLabel)).size).toBe(4)
  })

  it('echoes an unknown value back rather than throwing', () => {
    expect(roleLabel('SOMETHING_UNKNOWN' as (typeof ROLES)[number])).toBe('SOMETHING_UNKNOWN')
  })
})

// --- isOnlyActiveGlobalAdmin / canManageUser (last-admin UX guard) ----------------------------------

function user(overrides: Partial<TenantUser> & { id: string }): TenantUser {
  return {
    email: `${overrides.id}@acme.com`,
    active: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    roles: [],
    ...overrides,
  }
}

const GLOBAL_ADMIN = { role: 'ADMIN_KLIENTA' as const, unitId: null }
const UNIT_ADMIN = (unitId: string) => ({ role: 'ADMIN_KLIENTA' as const, unitId })
const GLOBAL_HR = { role: 'HR' as const, unitId: null }

describe('isOnlyActiveGlobalAdmin', () => {
  it('is true for the sole active global admin among many users', () => {
    const users = [
      user({ id: 'admin-1', roles: [GLOBAL_ADMIN] }),
      user({ id: 'hr-1', roles: [GLOBAL_HR] }),
      user({ id: 'pracownik-1', roles: [] }),
    ]
    expect(isOnlyActiveGlobalAdmin(users, 'admin-1')).toBe(true)
  })

  it('is false when a second active global admin exists', () => {
    const users = [
      user({ id: 'admin-1', roles: [GLOBAL_ADMIN] }),
      user({ id: 'admin-2', roles: [GLOBAL_ADMIN] }),
    ]
    expect(isOnlyActiveGlobalAdmin(users, 'admin-1')).toBe(false)
    expect(isOnlyActiveGlobalAdmin(users, 'admin-2')).toBe(false)
  })

  it('ignores a unit-scoped ADMIN_KLIENTA grant — only unitId: null counts as GLOBAL', () => {
    const users = [
      user({ id: 'admin-1', roles: [GLOBAL_ADMIN] }),
      user({ id: 'unit-admin-1', roles: [UNIT_ADMIN('unit-1')] }),
    ]
    expect(isOnlyActiveGlobalAdmin(users, 'admin-1')).toBe(true)
    expect(isOnlyActiveGlobalAdmin(users, 'unit-admin-1')).toBe(false)
  })

  it('ignores an INACTIVE global admin — a deactivated admin does not count towards the pool', () => {
    const users = [
      user({ id: 'admin-1', roles: [GLOBAL_ADMIN] }),
      user({ id: 'admin-2', active: false, roles: [GLOBAL_ADMIN] }),
    ]
    expect(isOnlyActiveGlobalAdmin(users, 'admin-1')).toBe(true)
  })

  it('is false for a user with no ADMIN_KLIENTA grant at all', () => {
    const users = [user({ id: 'admin-1', roles: [GLOBAL_ADMIN] }), user({ id: 'hr-1', roles: [GLOBAL_HR] })]
    expect(isOnlyActiveGlobalAdmin(users, 'hr-1')).toBe(false)
  })

  it('is false when there are zero active global admins (target not in the — empty — pool)', () => {
    const users = [user({ id: 'hr-1', roles: [GLOBAL_HR] })]
    expect(isOnlyActiveGlobalAdmin(users, 'hr-1')).toBe(false)
  })
})

describe('canManageUser', () => {
  it('disables management for the tenant sole remaining active global admin', () => {
    const users = [user({ id: 'admin-1', roles: [GLOBAL_ADMIN] }), user({ id: 'hr-1', roles: [GLOBAL_HR] })]
    expect(canManageUser(users[0], users)).toBe(false)
  })

  it('enables management for every other user, including a second admin', () => {
    const users = [
      user({ id: 'admin-1', roles: [GLOBAL_ADMIN] }),
      user({ id: 'admin-2', roles: [GLOBAL_ADMIN] }),
      user({ id: 'hr-1', roles: [GLOBAL_HR] }),
    ]
    expect(canManageUser(users[0], users)).toBe(true)
    expect(canManageUser(users[1], users)).toBe(true)
    expect(canManageUser(users[2], users)).toBe(true)
  })
})

// --- humanizeUsersError -------------------------------------------------------------------------------

describe('humanizeUsersError', () => {
  it('translates the duplicate-email 409 from UsersService.mapWriteError', () => {
    expect(humanizeUsersError(409, 'A user with this email already exists')).toBe(
      'Użytkownik z tym adresem e-mail już istnieje.',
    )
  })

  it('translates the last-admin 409 from guardedAdminMutation', () => {
    expect(humanizeUsersError(409, 'Cannot remove the last ADMIN_KLIENTA of this tenant')).toBe(
      'Nie można odebrać roli ostatniemu adminowi klienta w tej organizacji.',
    )
  })

  it('translates the concurrent-admin-roster-race 409 (serialization failure)', () => {
    expect(humanizeUsersError(409, 'Admin roster changed concurrently — please retry')).toBe(
      'Lista adminów zmieniła się w międzyczasie. Odśwież listę i spróbuj ponownie.',
    )
  })

  it('translates the self-escalation 403 from assignRole', () => {
    expect(humanizeUsersError(403, 'Cannot grant yourself a role higher than your current (real) role')).toBe(
      'Nie możesz nadać sobie wyższej roli niż aktualnie posiadasz.',
    )
  })

  it('falls back to a generic Polish message for any other 403 (ADMIN_KLIENTA-required, actor inactive, …)', () => {
    expect(humanizeUsersError(403, 'Only ADMIN_KLIENTA may invite users')).toBe(
      'Brak uprawnień administratora klienta do wykonania tej operacji.',
    )
    expect(humanizeUsersError(403, 'Actor is not an active user in the current DB state')).toBe(
      'Brak uprawnień administratora klienta do wykonania tej operacji.',
    )
  })

  it('passes an unrecognized message through unchanged', () => {
    expect(humanizeUsersError(500, 'Internal error')).toBe('Internal error')
    expect(humanizeUsersError(404, 'User abc not found')).toBe('User abc not found')
  })
})

// --- buildInviteBody -----------------------------------------------------------------------------------

describe('buildInviteBody', () => {
  function form(overrides: Partial<InviteFormState> = {}): InviteFormState {
    return { ...EMPTY_INVITE_FORM, ...overrides }
  }

  it('builds a minimal body from email + role only, omitting unitId', () => {
    const result = buildInviteBody(form({ email: 'new@acme.com', role: 'HR' }))
    expect(result).toEqual({ email: 'new@acme.com', role: 'HR' })
  })

  it('trims email and includes a well-formed unitId', () => {
    const result = buildInviteBody(
      form({ email: '  new@acme.com  ', role: 'MANAGER', unitId: '11111111-1111-1111-1111-111111111111' }),
    )
    expect(result).toEqual({ email: 'new@acme.com', role: 'MANAGER', unitId: '11111111-1111-1111-1111-111111111111' })
  })

  it('rejects an empty email', () => {
    expect(buildInviteBody(form({ email: '  ' }))).toEqual({ error: 'Podaj adres e-mail.' })
  })

  it('rejects a malformed email', () => {
    expect(buildInviteBody(form({ email: 'not-an-email' }))).toEqual({ error: 'Nieprawidłowy adres e-mail.' })
  })

  it('rejects an unknown role', () => {
    expect(buildInviteBody(form({ email: 'a@b.com', role: 'SUPERADMIN' as InviteFormState['role'] }))).toEqual({
      error: 'Wybierz rolę.',
    })
  })

  it('rejects a malformed unitId', () => {
    expect(buildInviteBody(form({ email: 'a@b.com', unitId: 'not-a-uuid' }))).toEqual({
      error: 'Nieprawidłowy identyfikator jednostki (oczekiwano UUID).',
    })
  })

  it('treats a whitespace-only unitId as absent (no error, unitId omitted)', () => {
    const result = buildInviteBody(form({ email: 'a@b.com', unitId: '   ' }))
    expect(result).toEqual({ email: 'a@b.com', role: 'PRACOWNIK' })
  })
})
