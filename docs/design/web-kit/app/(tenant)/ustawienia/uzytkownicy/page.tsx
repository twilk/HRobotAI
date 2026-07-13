import { AppShell } from '@/components/layout/app-shell'
import { UsersScreen } from '@/components/users/users-screen'
import { EmptyState } from '@/components/ui/empty-state'
import { IconLock } from '@/components/icons'
import type { Role } from '@/lib/nav'
import { getSession } from '@/lib/session'

// Server shell (identity/AppShell) + ADMIN_KLIENTA gate — mirrors app/(tenant)/ai-grafik-manager/
// page.tsx's canManage/EmptyState shape. The nav item (lib/nav.ts) is already ADMIN_KLIENTA-only, so
// a non-admin never sees this in the menu, but direct navigation must still be denied gracefully
// instead of rendering a screen whose every fetch would 403 anyway (UsersController is
// ADMIN_KLIENTA-only for EVERY route — see users.controller.ts's class-level @TenantRoute).
export default async function UzytkownicyPage() {
  const session = await getSession()
  const tenant = { name: '4Mobility sp. z o.o.', slug: '4mobility.hrobot.ai' }
  const user = session?.user ?? { name: 'Użytkownik', role: '—', initials: '?' }
  const roles: Role[] = session?.roles ?? []
  const isAdmin = roles.includes('ADMIN_KLIENTA')

  return (
    <AppShell activeHref="/ustawienia/uzytkownicy" title="Użytkownicy" tenant={tenant} user={user} roles={roles}>
      {isAdmin ? (
        <UsersScreen />
      ) : (
        <EmptyState icon={IconLock} title="Brak dostępu">
          Ta strona jest dostępna tylko dla admina klienta. Zaproszenia i role RBAC (Pracownik,
          Manager, HR, Admin klienta) zarządzane są wyłącznie stąd.
        </EmptyState>
      )}
    </AppShell>
  )
}
