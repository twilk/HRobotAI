import { AppShell } from '@/components/layout/app-shell'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { SetupChecklist, type ChecklistStep } from '@/components/dashboard/setup-checklist'
import { DataProtectionPanel } from '@/components/dashboard/data-protection-panel'
import type { Role } from '@/lib/nav'

// Server Component. In the real app, derive identity from the Auth.js session and
// tenant context resolved by middleware, e.g.:
//   const session = await auth()
//   const tenant  = await getTenantForRequest()   // reads x-tenant-id header
//   const roles   = session.user.roles as Role[]
// Fetch independent data with Promise.all to avoid request waterfalls.

export default async function DashboardPage() {
  const tenant = { name: '4Mobility sp. z o.o.', slug: '4mobility.hrobot.ai' }
  const user = { name: 'Jan Kowalski', role: 'Admin klienta', initials: 'JK' }
  const roles: Role[] = ['ADMIN_KLIENTA']

  // From tenants.onboarding_checklist (org-level Json column).
  const checklist: ChecklistStep[] = [
    { label: 'Dodaj pierwszego pracownika', desc: 'Wprowadź dane kadrowe — PESEL jest szyfrowany automatycznie.' },
    { label: 'Utwórz jednostkę organizacyjną', desc: 'Zbuduj strukturę działów i przypisz menedżerów.' },
    { label: 'Ustaw strefy czasowe i godziny pracy', desc: 'Podstawa pod automatyczne grafiki i wnioski urlopowe.' },
  ]

  return (
    <AppShell activeHref="/dashboard" title="Dashboard" tenant={tenant} user={user} roles={roles}>
      <div className="max-w-[1120px] mx-auto">
        <h1 className="font-display font-extrabold text-3xl tracking-tighter2 text-navy leading-tight">
          Witaj w HRobot, <span className="text-accent-ink">4Mobility</span>
        </h1>
        <p className="text-muted text-[15px] mt-2 max-w-[52ch]">
          Zacznij od kilku kroków, aby skonfigurować swój zespół. HRobot zajmie się resztą, w tle, zgodnie z RODO.
        </p>

        <div className="mt-6">
          <QuickActions />
        </div>

        <div className="grid lg:grid-cols-[1.06fr_0.94fr] gap-4 mt-4">
          <SetupChecklist steps={checklist} />
          <DataProtectionPanel />
        </div>
      </div>
    </AppShell>
  )
}
