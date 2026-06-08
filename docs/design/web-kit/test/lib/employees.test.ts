import { describe, it, expect, beforeEach } from 'vitest'
import {
  getEmployee,
  getEmployees,
  employeeInitials,
  employeeFullName,
  updateEmployee,
  setEmployeeStatus,
  resetEmployees,
} from '@/lib/employees'

describe('employees lib — read', () => {
  it('returns all employees', () => {
    expect(getEmployees().length).toBeGreaterThanOrEqual(6)
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

describe('updateEmployee', () => {
  beforeEach(() => {
    resetEmployees()
  })

  it('updates firstName', () => {
    const result = updateEmployee('1', { firstName: 'Zofia' })
    expect(result).not.toBeNull()
    expect(result!.firstName).toBe('Zofia')
    expect(getEmployee('1')!.firstName).toBe('Zofia')
  })

  it('updates department (unit)', () => {
    const result = updateEmployee('2', { unit: 'IT' })
    expect(result).not.toBeNull()
    expect(result!.unit).toBe('IT')
    expect(getEmployee('2')!.unit).toBe('IT')
  })

  it('updates position', () => {
    const result = updateEmployee('3', { position: 'Senior HR' })
    expect(result).not.toBeNull()
    expect(result!.position).toBe('Senior HR')
  })

  it('updates email', () => {
    const result = updateEmployee('1', { email: 'new@acme.pl' })
    expect(result).not.toBeNull()
    expect(result!.email).toBe('new@acme.pl')
  })

  it('updates phone', () => {
    const result = updateEmployee('1', { phone: '+48 600 000 001' })
    expect(result).not.toBeNull()
    expect(result!.phone).toBe('+48 600 000 001')
  })

  it('updates lastName', () => {
    const result = updateEmployee('1', { lastName: 'Testowa' })
    expect(result).not.toBeNull()
    expect(result!.lastName).toBe('Testowa')
  })

  it('returns null for unknown id', () => {
    expect(updateEmployee('999', { firstName: 'X' })).toBeNull()
  })

  it('does not mutate other employees', () => {
    updateEmployee('1', { firstName: 'Changed' })
    expect(getEmployee('2')!.firstName).toBe('Piotr')
  })
})

describe('setEmployeeStatus', () => {
  beforeEach(() => {
    resetEmployees()
  })

  it('sets status to active', () => {
    const result = setEmployeeStatus('5', 'active')
    expect(result).not.toBeNull()
    expect(result!.status).toBe('active')
    expect(getEmployee('5')!.status).toBe('active')
  })

  it('sets status to inactive', () => {
    const result = setEmployeeStatus('1', 'inactive')
    expect(result).not.toBeNull()
    expect(result!.status).toBe('inactive')
  })

  it('sets status to on-leave', () => {
    const result = setEmployeeStatus('2', 'on-leave')
    expect(result).not.toBeNull()
    expect(result!.status).toBe('on-leave')
  })

  it('sets status to suspended', () => {
    const result = setEmployeeStatus('3', 'suspended')
    expect(result).not.toBeNull()
    expect(result!.status).toBe('suspended')
  })

  it('returns null for unknown id', () => {
    expect(setEmployeeStatus('999', 'active')).toBeNull()
  })
})
