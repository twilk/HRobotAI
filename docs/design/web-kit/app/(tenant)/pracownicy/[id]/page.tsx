import { notFound } from 'next/navigation'
import { AppShell } from '@/components/layout/app-shell'
import { EmployeeDetailView } from '@/components/employees/employee-detail'
import { getEmployee } from '@/lib/employees'
import { requirePageSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

export default async function PracownikPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, tenant, roles } = await requirePageSession()
  const { id } = await params
  const employee = getEmployee(id)
  if (!employee) notFound()

  return (
    <AppShell activeHref="/pracownicy" title="Pracownicy" tenant={tenant} user={user} roles={roles}>
      <EmployeeDetailView employee={employee} actor={user.name} />
    </AppShell>
  )
}
