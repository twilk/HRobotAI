import { AppShell } from '@/components/layout/app-shell'
import { PracownicyClientView } from '@/components/employees/pracownicy-client-view'
import { getEmployees } from '@/lib/employees'
import { requirePageSession } from '@/lib/session'

export default async function PracownicyPage() {
  const { user, tenant, roles } = await requirePageSession()
  const rawEmployees = getEmployees()
  const employees = rawEmployees.map(({ id, firstName, lastName, email, position, unit, contract, peselLast4, status }) =>
    ({ id, firstName, lastName, email, position, unit, contract, peselLast4, status })
  )

  return (
    <AppShell activeHref="/pracownicy" title="Pracownicy" tenant={tenant} user={user} roles={roles}>
      <PracownicyClientView initialEmployees={employees} />
    </AppShell>
  )
}
