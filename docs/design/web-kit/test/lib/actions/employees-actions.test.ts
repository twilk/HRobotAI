import { describe, it, expect, beforeEach } from 'vitest'
import { editEmployee, changeEmployeeStatus, addNewEmployee } from '@/lib/actions/employees-actions'
import { getEmployee, getEmployees, resetEmployees } from '@/lib/employees'

beforeEach(() => {
  resetEmployees()
})

describe('editEmployee', () => {
  it('persists firstName change and returns success + employee', async () => {
    const result = await editEmployee('1', { firstName: 'Zofia' })
    expect(result.success).toBe(true)
    expect(result.employee?.firstName).toBe('Zofia')
    expect(getEmployee('1')?.firstName).toBe('Zofia')
  })

  it('persists position change', async () => {
    const result = await editEmployee('2', { position: 'Senior Developer' })
    expect(result.success).toBe(true)
    expect(result.employee?.position).toBe('Senior Developer')
  })

  it('persists unit (department) change', async () => {
    const result = await editEmployee('3', { unit: 'R&D' })
    expect(result.success).toBe(true)
    expect(getEmployee('3')?.unit).toBe('R&D')
  })

  it('returns error for unknown id', async () => {
    const result = await editEmployee('999', { firstName: 'Ghost' })
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('persists email change', async () => {
    const result = await editEmployee('1', { email: 'updated@acme.pl' })
    expect(result.success).toBe(true)
    expect(result.employee?.email).toBe('updated@acme.pl')
  })
})

describe('changeEmployeeStatus', () => {
  it('sets status to inactive', async () => {
    const result = await changeEmployeeStatus('1', 'inactive', 'admin@acme.pl')
    expect(result.success).toBe(true)
    expect(getEmployee('1')?.status).toBe('inactive')
  })

  it('sets status to on-leave', async () => {
    const result = await changeEmployeeStatus('2', 'on-leave', 'admin@acme.pl')
    expect(result.success).toBe(true)
    expect(getEmployee('2')?.status).toBe('on-leave')
  })

  it('sets status to active', async () => {
    // First set to inactive
    await changeEmployeeStatus('5', 'inactive', 'admin@acme.pl')
    const result = await changeEmployeeStatus('5', 'active', 'admin@acme.pl')
    expect(result.success).toBe(true)
    expect(getEmployee('5')?.status).toBe('active')
  })

  it('rejects invalid status value', async () => {
    const result = await changeEmployeeStatus('1', 'fired' as any, 'admin@acme.pl')
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('returns error for unknown id', async () => {
    const result = await changeEmployeeStatus('999', 'active', 'admin@acme.pl')
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

describe('addNewEmployee', () => {
  it('creates a new employee and returns success + employee', async () => {
    const before = getEmployees().length
    const result = await addNewEmployee({
      firstName: 'Nowy',
      lastName: 'Pracownik',
      email: 'nowy@acme.pl',
      position: 'Developer',
      unit: 'IT',
      contract: 'B2B',
      peselLast4: '1234',
    })
    expect(result.success).toBe(true)
    expect(result.employee?.firstName).toBe('Nowy')
    expect(getEmployees().length).toBe(before + 1)
  })

  it('new employee is retrievable by id', async () => {
    const result = await addNewEmployee({
      firstName: 'Jan',
      lastName: 'Nowy',
      email: 'jan.nowy@acme.pl',
      position: 'QA',
      unit: 'Testing',
      contract: 'UoP',
      peselLast4: '5678',
    })
    expect(result.success).toBe(true)
    const stored = getEmployee(result.employee!.id)
    expect(stored).toBeDefined()
    expect(stored?.status).toBe('active')
  })
})
