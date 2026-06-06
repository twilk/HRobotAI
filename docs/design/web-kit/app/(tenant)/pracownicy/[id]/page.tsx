import { notFound } from 'next/navigation'
import { AppShell } from '@/components/layout/app-shell'
import { EmployeeDetailView } from '@/components/employees/employee-detail'
import { getEmployee, getEmployees } from '@/lib/employees'
import type { Role } from '@/lib/nav'

/** Prerender the known employees (in the real app this route is dynamic per tenant). */
export function generateStaticParams() {
  return getEmployees().map((e) => ({ id: e.id }))
}

export default async function PracownikPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const employee = getEmployee(id)
  if (!employee) notFound()

  const tenant = { name: 'ACME Sp. z o.o.', slug: 'acme.hrobot.ai' }
  const user = { name: 'Jan Kowalski', role: 'Admin klienta', initials: 'JK' }
  const roles: Role[] = ['ADMIN_KLIENTA']

  return (
    <AppShell activeHref="/pracownicy" title="Pracownicy" tenant={tenant} user={user} roles={roles}>
      <EmployeeDetailView employee={employee} actor={user.name} />
    </AppShell>
  )
}
