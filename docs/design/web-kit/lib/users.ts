export type UserRole = 'PRACOWNIK' | 'MANAGER' | 'HR' | 'ADMIN_KLIENTA'

export interface AppUser {
  id: string
  name: string
  email: string
  roles: UserRole[]
  status: 'active' | 'invited' | 'inactive'
  initials: string
}

const ROLE_LABELS: Record<UserRole, string> = {
  PRACOWNIK: 'Pracownik',
  MANAGER: 'Manager',
  HR: 'HR',
  ADMIN_KLIENTA: 'Admin klienta',
}

const USERS: AppUser[] = [
  { id: 'u1', name: 'Jan Kowalski', email: 'jan.kowalski@acme.pl', roles: ['ADMIN_KLIENTA'], status: 'active', initials: 'JK' },
  { id: 'u2', name: 'Maria Nowak', email: 'maria.nowak@acme.pl', roles: ['HR', 'MANAGER'], status: 'active', initials: 'MN' },
  { id: 'u3', name: 'Piotr Wiśniewski', email: 'piotr.wisniewski@acme.pl', roles: ['MANAGER'], status: 'active', initials: 'PW' },
  { id: 'u4', name: 'Anna Wójcik', email: 'anna.wojcik@acme.pl', roles: ['PRACOWNIK'], status: 'invited', initials: 'AW' },
]

export function getUsers(): AppUser[] {
  return USERS
}

export function roleLabel(role: UserRole): string {
  return ROLE_LABELS[role]
}
