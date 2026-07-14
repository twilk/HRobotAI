import { AppShell } from '@/components/layout/app-shell'
import { DostepyScreen } from '@/components/dostepy/dostepy-screen'
import { EmptyState } from '@/components/ui/empty-state'
import { IconLock } from '@/components/icons'
import type { Role } from '@/lib/nav'
import { getSession } from '@/lib/session'

// Server shell (identity/AppShell); the access-grant workspace is a Client Component that reads/
// writes the REAL tenant-runtime `/dostepy` API through the /api/dostepy/* proxy. The nav item
// (lib/nav.ts) already restricts "Dostępy" to MANAGER/HR/ADMIN_KLIENTA, so a plain PRACOWNIK never
// sees it in the menu — but direct navigation must still be denied gracefully, mirroring
// app/(tenant)/ai-grafik-manager/page.tsx's EmptyState+IconLock gate.
export default async function DostepyPage() {
  const session = await getSession()
  const tenant = { name: '4Mobility sp. z o.o.', slug: '4mobility.hrobot.ai' }
  const user = session?.user ?? { name: 'Użytkownik', role: '—', initials: '?' }
  const roles: Role[] = session?.roles ?? []
  const canManage = roles.some((r) => r === 'MANAGER' || r === 'HR' || r === 'ADMIN_KLIENTA')

  return (
    <AppShell activeHref="/dostepy" title="Dostępy" tenant={tenant} user={user} roles={roles}>
      {canManage ? (
        <DostepyScreen />
      ) : (
        <EmptyState icon={IconLock} title="Brak dostępu">
          Ta strona jest dostępna tylko dla managera, HR lub admina klienta.
        </EmptyState>
      )}
    </AppShell>
  )
}
