import { AppShell } from '@/components/layout/app-shell'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { SetupChecklist, type ChecklistStep } from '@/components/dashboard/setup-checklist'
import { DataProtectionPanel } from '@/components/dashboard/data-protection-panel'
import { StatsPanel } from '@/components/dashboard/stats-panel'
import { requirePageSession } from '@/lib/session'
import { getHRSummary } from '@/lib/raporty'

export default async function DashboardPage() {
  const { user, tenant, roles } = await requirePageSession()
  const summary = getHRSummary()

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
          Witaj w HRobot, <span className="text-accent-ink">ACME</span>
        </h1>
        <p className="text-muted text-[15px] mt-2 max-w-[52ch]">
          Zacznij od kilku kroków, aby skonfigurować swój zespół. HRobot zajmie się resztą, w tle, zgodnie z RODO.
        </p>

        <div className="mt-6">
          <StatsPanel summary={summary} />
        </div>

        <div className="mt-4">
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
