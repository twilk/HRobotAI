import { AppShell } from '@/components/layout/app-shell'
import { EmployeeProfile } from '@/components/employees/employee-profile'
import type { Role } from '@/lib/nav'
import { getSession } from '@/lib/session'

// Server shell (identity/AppShell), mirrors ../page.tsx (the roster). The profile card itself is a
// Client Component that fetches the REAL tenant-runtime employee through the authenticated
// /api/employees/:id proxy — same RODO-safe projection as the roster, plus a masked `peselLast4` for
// an HR/ADMIN_KLIENTA session. `params` is a Promise in Next 15.
export default async function PracownikProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()
  const tenant = { name: '4Mobility sp. z o.o.', slug: '4mobility.hrobot.ai' }
  const user = session?.user ?? { name: 'Użytkownik', role: '—', initials: '?' }
  const roles: Role[] = session?.roles ?? []
  // Only HR/ADMIN_KLIENTA ever receive peselLast4 from the backend (employees.service.ts#getById) —
  // mirror that exact gate here. Task 3's edit form will also gate on this.
  const canManage = roles.some((r) => r === 'HR' || r === 'ADMIN_KLIENTA')

  return (
    <AppShell activeHref="/pracownicy" title="Profil pracownika" tenant={tenant} user={user} roles={roles}>
      <EmployeeProfile id={id} canManage={canManage} />
    </AppShell>
  )
}
