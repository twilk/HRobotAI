import { AppShell } from '@/components/layout/app-shell'
import { AiConfigPanel } from '@/components/ai-grafik/ai-config-panel'
import type { Role } from '@/lib/nav'
import { getSession } from '@/lib/session'

// Server shell (identity/AppShell); the config editor is a Client Component that reads/writes the
// tenant-wide AI scheduling policy from the REAL tenant-runtime ai-grafik API through the
// /api/ai-grafik/* proxy. Only scheduling roles (MANAGER/HR/ADMIN_KLIENTA) may manage the policy;
// a plain PRACOWNIK gets a "brak dostępu" note. Identity comes from the real Keycloak session.
export default async function AiGrafikManagerPage() {
  const session = await getSession()
  const tenant = { name: '4Mobility sp. z o.o.', slug: '4mobility.hrobot.ai' }
  const user = session?.user ?? { name: 'Użytkownik', role: '—', initials: '?' }
  const roles: Role[] = session?.roles ?? []
  const canManage = roles.some((r) => r === 'MANAGER' || r === 'HR' || r === 'ADMIN_KLIENTA')

  return (
    <AppShell activeHref="/ai-grafik-manager" title="AI Grafik Manager" tenant={tenant} user={user} roles={roles}>
      {canManage ? (
        <AiConfigPanel />
      ) : (
        <div
          className="max-w-[720px] mx-auto rounded-lg border border-line-strong bg-card px-4 py-3 text-[13.5px] text-muted"
          role="note"
        >
          Brak dostępu — konfiguracją AI Grafik Managera zarządzają role Menedżer, HR i Admin klienta.
        </div>
      )}
    </AppShell>
  )
}
