'use server'

import {
  updateEmployee,
  setEmployeeStatus,
  addEmployee,
  type EmployeeUpdateFields,
  type EmployeeDetail,
} from '@/lib/employees'

const VALID_STATUSES = ['active', 'inactive', 'on-leave', 'suspended'] as const
type ValidStatus = (typeof VALID_STATUSES)[number]

export async function editEmployee(
  id: string,
  updates: EmployeeUpdateFields,
): Promise<{ success: boolean; employee?: EmployeeDetail; error?: string }> {
  const updated = updateEmployee(id, updates)
  if (!updated) {
    return { success: false, error: `Employee '${id}' not found` }
  }
  return { success: true, employee: updated }
}

export async function changeEmployeeStatus(
  id: string,
  status: string,
  changedBy: string,
): Promise<{ success: boolean; error?: string }> {
  if (!(VALID_STATUSES as readonly string[]).includes(status)) {
    return { success: false, error: `Invalid status '${status}'. Must be one of: ${VALID_STATUSES.join(', ')}` }
  }
  const updated = setEmployeeStatus(id, status as ValidStatus)
  if (!updated) {
    return { success: false, error: `Employee '${id}' not found` }
  }
  return { success: true }
}

export async function addNewEmployee(
  data: Omit<EmployeeDetail, 'id' | 'region' | 'realm' | 'audit' | 'phone' | 'address' | 'birthYear' | 'hireDate' | 'contractType' | 'fte' | 'manager' | 'salaryMasked'>,
): Promise<{ success: boolean; employee?: EmployeeDetail; error?: string }> {
  const id = Math.random().toString(36).slice(2)
  const employee = addEmployee({
    ...data,
    id,
    status: 'active',
    phone: '',
    address: '',
    birthYear: '',
    hireDate: new Date().toISOString().slice(0, 10),
    contractType: data.contract === 'UoP' ? 'Czas nieokreślony' : data.contract === 'Zlecenie' ? 'Umowa zlecenie' : 'Kontrakt B2B',
    fte: 'Pełny etat · 1,0',
    manager: '',
    salaryMasked: '•• ••• PLN',
  })
  return { success: true, employee }
}
