'use server'
import { updateAccess, type AccessModule, type AccessLevel } from '@/lib/dostepy'

const VALID_MODULES: AccessModule[] = ['grafik', 'wnioski', 'dostepy', 'raporty', 'ustawienia']
const VALID_LEVELS: AccessLevel[] = ['brak', 'podgląd', 'edycja', 'admin']

export async function updateEmployeeAccess(
  employeeId: string,
  module: AccessModule,
  level: AccessLevel,
  grantedBy: string,
): Promise<{ success: boolean; error?: string }> {
  if (!VALID_MODULES.includes(module)) {
    return { success: false, error: `Invalid module: '${module}'. Must be one of: ${VALID_MODULES.join(', ')}` }
  }
  if (!VALID_LEVELS.includes(level)) {
    return { success: false, error: `Invalid level: '${level}'. Must be one of: ${VALID_LEVELS.join(', ')}` }
  }

  updateAccess(employeeId, module, level, grantedBy)
  return { success: true }
}

export async function updateAllEmployeeAccess(
  employeeId: string,
  accessMap: Record<AccessModule, AccessLevel>,
  grantedBy: string,
): Promise<{ success: boolean; error?: string }> {
  for (const module of VALID_MODULES) {
    const level = accessMap[module]
    if (!VALID_LEVELS.includes(level)) {
      return { success: false, error: `Invalid level '${level}' for module '${module}'` }
    }
  }

  for (const module of VALID_MODULES) {
    updateAccess(employeeId, module, accessMap[module], grantedBy)
  }

  return { success: true }
}
