import { describe, it, expect } from 'vitest'
import { getEmployee, getEmployees, employeeInitials, employeeFullName } from '@/lib/employees'

describe('employees lib', () => {
  it('returns all employees', () => {
    expect(getEmployees()).toHaveLength(6)
  })

  it('getEmployee finds by id and returns undefined for unknown', () => {
    expect(getEmployee('1')?.lastName).toBe('Nowak')
    expect(getEmployee('999')).toBeUndefined()
  })

  it('never exposes full PESEL — last 4 digits only (RODO)', () => {
    for (const e of getEmployees()) {
      expect(e.peselLast4).toMatch(/^\d{4}$/)
      // no full-PESEL field leaks onto the client model
      expect((e as Record<string, unknown>).pesel).toBeUndefined()
    }
  })

  it('formats name + initials', () => {
    const e = { firstName: 'Anna', lastName: 'Nowak' }
    expect(employeeFullName(e)).toBe('Anna Nowak')
    expect(employeeInitials(e)).toBe('AN')
  })
})
