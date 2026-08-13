import { describe, expect, it } from 'vitest'
import { LEGEND_ROLES, roleBar, roleSwatch } from './grafik-roles'

describe('grafik-roles', () => {
  it('gives every legend role its own colour', () => {
    const bars = LEGEND_ROLES.map(roleBar)
    const swatches = LEGEND_ROLES.map(roleSwatch)
    expect(new Set(bars).size).toBe(LEGEND_ROLES.length)
    expect(new Set(swatches).size).toBe(LEGEND_ROLES.length)
  })

  it('falls back to a neutral marker for a role it does not know', () => {
    // A new role from the backend must still get a bar — an unmarked chip would read as "no role".
    expect(roleBar('DYSPOZYTOR')).toBe(roleBar('CZEGOŚ_TAKIEGO_NIE_MA'))
    expect(roleBar('DYSPOZYTOR')).not.toBe(roleBar('KIEROWCA'))
    expect(roleSwatch('DYSPOZYTOR')).not.toBe(roleSwatch('KIEROWCA'))
  })

  it('is case-insensitive, because `role` is a free-form string on the wire', () => {
    expect(roleBar('kierowca')).toBe(roleBar('KIEROWCA'))
    expect(roleSwatch('Koordynator')).toBe(roleSwatch('KOORDYNATOR'))
  })
})
