import { AppShell } from '@/components/layout/app-shell'
import { AiConfigPanel } from '@/components/ai-grafik/ai-config-panel'
import { ProposalInbox } from '@/components/ai-grafik/proposal-inbox'
import { EmptyState } from '@/components/ui/empty-state'
import { IconLock } from '@/components/icons'
import type { Role } from '@/lib/nav'
import { getSession } from '@/lib/session'

// Server shell (identity/AppShell); the config editor + manager proposal inbox are Client Components
// that read/write the REAL tenant-runtime ai-grafik API through the /api/ai-grafik/* proxy.
// MANAGER-ONLY again (product decision, restoring the SP0 locked scope): only scheduling roles
// (MANAGER/HR/ADMIN_KLIENTA) may manage the tenant-wide config, see the manager approval inbox, or
// trigger the vacated-shift scan. The nav item (lib/nav.ts) is restricted to those roles too, so a
// plain PRACOWNIK won't see this page in the menu — but direct navigation must still be denied
// gracefully rather than leaking the config/inbox. The employee's own AI replacement-consent section
// moved to /zamiany (components/ai-grafik/ai-consent-section.tsx). Identity comes from the real
// Keycloak session.
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
        <EmptyState icon={IconLock} title="Brak dostępu">
          Ta strona jest dostępna tylko dla managera, HR lub admina klienta. Propozycje zmian
          wymagające Twojej zgody znajdziesz na stronie{' '}
          <span className="font-medium">Zamiany</span>.
        </EmptyState>
      )}
    </AppShell>
  )
}
