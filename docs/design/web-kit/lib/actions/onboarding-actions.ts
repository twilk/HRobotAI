'use server'

import { addEmployee } from '@/lib/employees'
import { addLeaveBalance } from '@/lib/leave-balance'
import { updateAccess, type AccessModule } from '@/lib/dostepy'
import { addNotification } from '@/lib/notifications'

const ALL_MODULES: AccessModule[] = ['grafik', 'wnioski', 'dostepy', 'raporty', 'ustawienia']

/**
 * Coordinated onboarding action: creates the employee record, a notification,
 * default access entries (all modules at 'brak'), and an initial leave balance.
 */
export async function onboardNewEmployee(data: {
  name: string
  department: string
  position: string
  email: string
  phone?: string
}): Promise<{ success: boolean; employeeId?: string; error?: string }> {
  if (!data.name || !data.name.trim()) {
    return { success: false, error: 'Imię i nazwisko jest wymagane' }
  }
  if (!data.email || !data.email.trim()) {
    return { success: false, error: 'Email jest wymagany' }
  }

  const parts = data.name.trim().split(/\s+/)
  const firstName = parts[0]
  const lastName = parts.slice(1).join(' ') || parts[0]
  const fullName = `${firstName} ${lastName}`

  const id = Math.random().toString(36).slice(2)

  const newEmployee = addEmployee({
    id,
    firstName,
    lastName,
    email: data.email,
    position: data.position,
    unit: data.department,
    contract: 'UoP',
    peselLast4: '0000',
    status: 'active',
    phone: data.phone ?? '',
    address: '',
    birthYear: '',
    hireDate: new Date().toISOString().slice(0, 10),
    contractType: 'Czas nieokreślony',
    fte: 'Pełny etat · 1,0',
    manager: '',
    salaryMasked: '•• ••• PLN',
  })

  addNotification({
    type: 'employee-added',
    priority: 'medium',
    title: 'Nowy pracownik dodany',
    message: `${data.name} dołączył/a do zespołu.`,
    employeeId: newEmployee.id,
    actionUrl: `/pracownicy/${newEmployee.id}`,
  })

  for (const module of ALL_MODULES) {
    updateAccess(newEmployee.id, module, 'brak', 'System')
  }

  addLeaveBalance(newEmployee.id, fullName)

  return { success: true, employeeId: newEmployee.id }
}
