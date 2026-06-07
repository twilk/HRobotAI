import { AppShell } from '@/components/layout/app-shell'
import { ScheduleGrid } from '@/components/grafik/schedule-grid'
import { getFacilities } from '@/lib/facilities'
import { getEmployees } from '@/lib/employees'
import { SEED_SHIFTS, ymd } from '@/lib/schedule'
import { requirePageSession } from '@/lib/session'

// Live grafik: render with the real current week per request.
export const dynamic = 'force-dynamic'

export default async function GrafikPage() {
  const { user, tenant, roles } = await requirePageSession()

  const facilities = getFacilities()
  const employees = getEmployees().map((e) => ({
    id: e.id,
    firstName: e.firstName,
    lastName: e.lastName,
    position: e.position,
  }))
  const todayISO = ymd(new Date())

  return (
    <AppShell activeHref="/grafik" title="Grafik" tenant={tenant} user={user} roles={roles}>
      <ScheduleGrid facilities={facilities} employees={employees} seed={SEED_SHIFTS} todayISO={todayISO} />
    </AppShell>
  )
}
