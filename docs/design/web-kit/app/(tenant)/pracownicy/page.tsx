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
  // Hide the PESEL column for a plain PRACOWNIK: the roster API never returns a PESEL for them (RODO),
  // so the column is just a "•••" placeholder with zero value in that context. Keep it for
  // MANAGER/HR/ADMIN (where it carries the "PESEL exists + protected" signal / future peselLast4).
  const showPesel = roles.some((r) => r === 'MANAGER' || r === 'HR' || r === 'ADMIN_KLIENTA')

  return (
    <AppShell activeHref="/pracownicy" title="Pracownicy" tenant={tenant} user={user} roles={roles}>
      <EmployeesScreen canManage={canManage} showPesel={showPesel} />
    </AppShell>
  )
}
