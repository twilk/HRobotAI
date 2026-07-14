import { AppShell } from '@/components/layout/app-shell'
import { UstawieniaScreen } from '@/components/ustawienia/ustawienia-screen'
import { EmptyState } from '@/components/ui/empty-state'
import { IconLock } from '@/components/icons'
import type { Role } from '@/lib/nav'
import { getSession } from '@/lib/session'

// Server shell (identity/AppShell); the company-settings + org-unit editor is a Client Component that
// reads/writes the REAL tenant-runtime ustawienia API through the /api/ustawienia/* proxy.
//
// The backend opens GET /ustawienia/company + GET /ustawienia/units to MANAGER/HR/ADMIN_KLIENTA, but
// every WRITE (company PATCH, unit POST/PATCH) is ADMIN_KLIENTA-only. This page mirrors
// ai-grafik-manager's EmptyState pattern rather than offering a read-only view to MANAGER/HR: the nav
// item (lib/nav.ts) is already restricted to ADMIN_KLIENTA, so a non-admin only ever lands here via
// direct navigation — deny gracefully instead of building a second (unrequested) read-only surface.
export default async function UstawieniaPage() {
  const session = await getSession()
  const tenant = { name: '4Mobility sp. z o.o.', slug: '4mobility.hrobot.ai' }
  const user = session?.user ?? { name: 'Użytkownik', role: '—', initials: '?' }
  const roles: Role[] = session?.roles ?? []
  const canEdit = roles.includes('ADMIN_KLIENTA')

  return (
    <AppShell activeHref="/ustawienia" title="Ustawienia" tenant={tenant} user={user} roles={roles}>
      {canEdit ? (
        <UstawieniaScreen />
      ) : (
        <EmptyState icon={IconLock} title="Brak dostępu">
          Ta strona jest dostępna tylko dla admina klienta.
        </EmptyState>
      )}
    </AppShell>
  )
}
