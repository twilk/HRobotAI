import { AppShell } from '@/components/layout/app-shell'
import { AiConfigPanel } from '@/components/ai-grafik/ai-config-panel'
import { ProposalInbox } from '@/components/ai-grafik/proposal-inbox'
import type { Role } from '@/lib/nav'
import { getSession } from '@/lib/session'

// Server shell (identity/AppShell); the config editor + proposal inbox are Client Components that
// read/write the REAL tenant-runtime ai-grafik API through the /api/ai-grafik/* proxy. Only
// scheduling roles (MANAGER/HR/ADMIN_KLIENTA) may manage the tenant-wide config AND see the manager
// approval inbox + vacated-shift scan; a plain PRACOWNIK still reaches this page (Task 1.5) to see —
// and act on — THEIR OWN pending consent request, if any. Identity comes from the real Keycloak
// session.
export default async function AiGrafikManagerPage() {
  const session = await getSession()
  const tenant = { name: '4Mobility sp. z o.o.', slug: '4mobility.hrobot.ai' }
  const user = session?.user ?? { name: 'Użytkownik', role: '—', initials: '?' }
  const roles: Role[] = session?.roles ?? []
  const canManage = roles.some((r) => r === 'MANAGER' || r === 'HR' || r === 'ADMIN_KLIENTA')

  return (
    <AppShell activeHref="/ai-grafik-manager" title="AI Grafik Manager" tenant={tenant} user={user} roles={roles}>
      {canManage ? (
        <div className="space-y-10">
          <AiConfigPanel />
          <ProposalInbox canManage />
        </div>
      ) : (
        <ProposalInbox canManage={false} />
      )}
    </AppShell>
  )
}
