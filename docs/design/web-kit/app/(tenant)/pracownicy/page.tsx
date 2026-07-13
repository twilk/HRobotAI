import { AppShell } from '@/components/layout/app-shell'
import { EmployeesScreen } from '@/components/employees/employees-screen'
import type { Role } from '@/lib/nav'
import { getSession } from '@/lib/session'

// Server shell (identity/AppShell). The roster itself is a Client Component that fetches the REAL
// tenant-runtime employees through the authenticated /api/employees proxy — same people as Grafik,
// not a static mock. PESEL never reaches the client (RODO; the API omits it).
export default async function PracownicyPage() {
  const session = await getSession()
  const tenant = { name: '4Mobility sp. z o.o.', slug: '4mobility.hrobot.ai' }
  const user = session?.user ?? { name: 'Użytkownik', role: '—', initials: '?' }
  const roles: Role[] = session?.roles ?? []
  // Only HR/ADMIN_KLIENTA may create employees (tenant-runtime POST /employees 403s everyone else) —
  // mirror the same gate the [id] profile page uses for "Edytuj".
  const canManage = roles.some((r) => r === 'HR' || r === 'ADMIN_KLIENTA')

  return (
    <AppShell activeHref="/pracownicy" title="Pracownicy" tenant={tenant} user={user} roles={roles}>
      <EmployeesScreen canManage={canManage} />
    </AppShell>
  )
}
