import { AppShell } from '@/components/layout/app-shell'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { DashboardKpis } from '@/components/dashboard/dashboard-kpis'
import { DataProtectionPanel } from '@/components/dashboard/data-protection-panel'
import { PracownikBoard } from '@/components/dashboard/pracownik-board'
import type { Role } from '@/lib/nav'
import { getSession } from '@/lib/session'

// Server Component. Identity comes from the real Keycloak session (the `hrobot_token` cookie set by
// the login action, decoded in lib/session). The KPI strip (DashboardKpis) is a Client Component that
// pulls live tenant numbers from the API, so the dashboard reflects real state — not a static onboarding.
//
// ROLE-ADAPTIVE: ONE route, sections conditioned on `session.roles` — NOT three separate route files
// (see docs/superpowers/specs/2026-07-14-role-dashboards-component-audit.md §A). A plain PRACOWNIK
// gets the self-service board (PracownikBoard) instead of org-wide KPIs + the RODO panel, which are
// not relevant to their job and (for the RODO panel) not their data to see. Everyone with MANAGER+
// keeps the existing KPI/quick-actions/RODO body — DashboardKpis already scopes server-side per role.

export default async function DashboardPage() {
  const session = await getSession()
  const tenant = { name: '4Mobility sp. z o.o.', slug: '4mobility.hrobot.ai' }
  const user = session?.user ?? { name: 'Użytkownik', role: '—', initials: '?' }
  const roles: Role[] = session?.roles ?? []
  const firstName = user.name.split(' ')[0]

  const isGlobal = roles.includes('ADMIN_KLIENTA') || roles.includes('HR')
  const canManage = isGlobal || roles.includes('MANAGER')

  return (
    <AppShell activeHref="/dashboard" title="Dashboard" tenant={tenant} user={user} roles={roles}>
      <div className="max-w-[1120px] mx-auto">
        <h1 className="font-display font-extrabold text-3xl tracking-tighter2 text-navy leading-tight">
          Pulpit <span className="text-accent-ink">4Mobility</span>
        </h1>
        <p className="text-muted text-[15px] mt-2 max-w-[52ch]">
          {canManage
            ? `Cześć, ${firstName}. Przegląd zespołu i grafiku na żywo — dane syntetyczne, zgodnie z RODO.`
            : `Cześć, ${firstName}. Twój grafik, godziny i wnioski — na żywo.`}
        </p>

        {canManage ? (
          <>
            <div className="mt-6">
              <DashboardKpis />
            </div>

            <div className="mt-4">
              <QuickActions roles={roles} />
            </div>

            <div className="mt-4">
              <DataProtectionPanel />
            </div>
          </>
        ) : (
          <>
            <div className="mt-6">
              <PracownikBoard />
            </div>

            <div className="mt-4">
              <QuickActions roles={roles} />
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}
