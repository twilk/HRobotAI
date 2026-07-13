import { AppShell } from '@/components/layout/app-shell'
import { AiConfigPanel } from '@/components/ai-grafik/ai-config-panel'
import { ProposalInbox } from '@/components/ai-grafik/proposal-inbox'
import { CostPanel } from '@/components/ai-grafik/cost-panel'
import { EmptyState } from '@/components/ui/empty-state'
import { IconLock } from '@/components/icons'
import type { Role } from '@/lib/nav'
import { getSession } from '@/lib/session'

// Server shell (identity/AppShell); the config editor + manager proposal inbox are Client Components
// that read/write the REAL tenant-runtime ai-grafik API through the /api/ai-grafik/* proxy.
//
// Two distinct scopes on this page:
//   • canManage (MANAGER/HR/ADMIN_KLIENTA) — may see the approval inbox + trigger the vacated-shift
//     scan. The nav item (lib/nav.ts) is restricted to these roles, so a plain PRACOWNIK never sees
//     the page in the menu — but direct navigation must still be denied gracefully.
//   • canEditConfig (HR/ADMIN_KLIENTA only = isGlobal) — may read/write the tenant-DEFAULT (null-unit)
//     AI scheduling config. This mirrors the backend RBAC: GET/PATCH /ai-grafik/config with no unitId
//     resolves the tenant-default config, which only global roles may touch — a MANAGER hitting it
//     WITHOUT a unitId gets a (correct) 403. So we render AiConfigPanel ONLY for canEditConfig,
//     otherwise a MANAGER would trip that 403 and see a spurious error banner.
//   FUTURE: per-unit manager config (AiConfigPanel scoped to a MANAGER's own unit via unitId) is a
//   planned enhancement; until then MANAGERs get inbox + scan but no config editor.
//
// The employee's own AI replacement-consent section moved to /zamiany
// (components/ai-grafik/ai-consent-section.tsx). Identity comes from the real Keycloak session.
export default async function AiGrafikManagerPage() {
  const session = await getSession()
  const tenant = { name: '4Mobility sp. z o.o.', slug: '4mobility.hrobot.ai' }
  const user = session?.user ?? { name: 'Użytkownik', role: '—', initials: '?' }
  const roles: Role[] = session?.roles ?? []
  const canManage = roles.some((r) => r === 'MANAGER' || r === 'HR' || r === 'ADMIN_KLIENTA')
  // isGlobal: only HR/ADMIN_KLIENTA may read/write the tenant-default config (backend returns 403 to a
  // MANAGER hitting /ai-grafik/config without a unitId), so gate the config panel on this SEPARATELY.
  const canEditConfig = roles.some((r) => r === 'HR' || r === 'ADMIN_KLIENTA')

  return (
    <AppShell activeHref="/ai-grafik-manager" title="AI Grafik Manager" tenant={tenant} user={user} roles={roles}>
      {canManage ? (
        <div className="space-y-10">
          {canEditConfig ? <AiConfigPanel /> : null}
          {/* Rate WRITES are HR/ADMIN_KLIENTA only (Codex P1-1) — the same `isGlobal` gate as
              canEditConfig, since both routes share the exact [HR, ADMIN_KLIENTA] roles set. */}
          <CostPanel canEditRates={canEditConfig} />
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
