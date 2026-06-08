import { describe, it, expect, beforeEach } from 'vitest'
import { onboardNewEmployee } from '@/lib/actions/onboarding-actions'
import { getEmployees, resetEmployees } from '@/lib/employees'
import { getNotifications, resetNotifications } from '@/lib/notifications'
import { getAccessEntries } from '@/lib/dostepy'
import { getLeaveBalance, resetLeaveBalances } from '@/lib/leave-balance'

beforeEach(() => {
  resetEmployees()
  resetNotifications()
  resetLeaveBalances()
})

const baseData = {
  name: 'Jan Testowy',
  department: 'IT',
  position: 'Developer',
  email: 'jan.testowy@acme.pl',
  phone: '+48 600 000 000',
}

describe('onboardNewEmployee', () => {
  it('creates an employee in the employee store', async () => {
    const before = getEmployees().length
    await onboardNewEmployee(baseData)
    expect(getEmployees().length).toBe(before + 1)
  })

  it('returns success: true with the new employeeId', async () => {
    const result = await onboardNewEmployee(baseData)
    expect(result.success).toBe(true)
    expect(result.employeeId).toBeTruthy()
    expect(typeof result.employeeId).toBe('string')
  })

  it('created employee has correct name, department and position', async () => {
    const result = await onboardNewEmployee(baseData)
    const emp = getEmployees().find((e) => e.id === result.employeeId)
    expect(emp).toBeDefined()
    expect(emp?.firstName).toBe('Jan')
    expect(emp?.lastName).toBe('Testowy')
    expect(emp?.unit).toBe('IT')
    expect(emp?.position).toBe('Developer')
    expect(emp?.email).toBe('jan.testowy@acme.pl')
  })

  it('creates a notification of type employee-added', async () => {
    const countBefore = getNotifications().length
    await onboardNewEmployee(baseData)
    const all = getNotifications()
    expect(all.length).toBe(countBefore + 1)
    const notif = all.find((n) => n.type === 'employee-added' && n.createdAt > new Date(Date.now() - 5000).toISOString())
    expect(notif).toBeDefined()
    expect(notif?.type).toBe('employee-added')
    expect(notif?.priority).toBe('medium')
    expect(notif?.title).toBe('Nowy pracownik dodany')
  })

  it('notification message includes the employee name', async () => {
    await onboardNewEmployee(baseData)
    const all = getNotifications()
    const notif = all.find((n) => n.type === 'employee-added' && n.message.includes('Jan Testowy'))
    expect(notif).toBeDefined()
    expect(notif?.message).toContain('Jan Testowy')
  })

  it('notification actionUrl links to the new employee profile', async () => {
    const result = await onboardNewEmployee(baseData)
    const all = getNotifications()
    const notif = all.find((n) => n.type === 'employee-added' && n.employeeId === result.employeeId)
    expect(notif).toBeDefined()
    expect(notif?.actionUrl).toBe(`/pracownicy/${result.employeeId}`)
  })

  it('creates access records for all 5 modules at brak level', async () => {
    const result = await onboardNewEmployee(baseData)
    const allEntries = getAccessEntries()
    const empEntries = allEntries.filter((e) => e.employeeId === result.employeeId)
    expect(empEntries.length).toBe(5)
    const modules = empEntries.map((e) => e.module).sort()
    expect(modules).toEqual(['dostepy', 'grafik', 'raporty', 'ustawienia', 'wnioski'])
    expect(empEntries.every((e) => e.level === 'brak')).toBe(true)
  })

  it('creates a leave balance record for the new employee', async () => {
    const result = await onboardNewEmployee(baseData)
    const balance = getLeaveBalance(result.employeeId!)
    expect(balance).toBeDefined()
    expect(balance?.employeeId).toBe(result.employeeId)
    expect(balance?.employeeName).toBe('Jan Testowy')
  })

  it('returns error when name is missing', async () => {
    const result = await onboardNewEmployee({ ...baseData, name: '' })
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('returns error when email is missing', async () => {
    const result = await onboardNewEmployee({ ...baseData, email: '' })
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('does not create employee when name is missing', async () => {
    const before = getEmployees().length
    await onboardNewEmployee({ ...baseData, name: '' })
    expect(getEmployees().length).toBe(before)
  })

  it('works without optional phone field', async () => {
    const { phone: _p, ...dataWithoutPhone } = baseData
    const result = await onboardNewEmployee(dataWithoutPhone)
    expect(result.success).toBe(true)
    expect(result.employeeId).toBeTruthy()
  })
})
