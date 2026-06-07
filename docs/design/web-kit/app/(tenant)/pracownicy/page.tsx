import { AppShell } from '@/components/layout/app-shell'
import { PracownicyClientView } from '@/components/employees/pracownicy-client-view'
import { getEmployees } from '@/lib/employees'
import type { Role } from '@/lib/nav'

export default async function PracownicyPage() {
  const tenant = { name: 'ACME Sp. z o.o.', slug: 'acme.hrobot.ai' }
  const user = { name: 'Jan Kowalski', role: 'Admin klienta', initials: 'JK' }
  const roles: Role[] = ['ADMIN_KLIENTA']
  const employees = getEmployees()

  return (
    <AppShell activeHref="/pracownicy" title="Pracownicy" tenant={tenant} user={user} roles={roles}>
      <PracownicyClientView initialEmployees={employees} />
    </AppShell>
  )
}
