import { AppShell } from '@/components/layout/app-shell'
import { WnioskiScreen } from '@/components/wnioski/wnioski-screen'
import type { Role } from '@/lib/nav'
import { getSession } from '@/lib/session'

// Server shell (identity/AppShell); the leave-request workflow is a Client Component that reads/
// writes the REAL tenant-runtime `/wnioski` API through the /api/wnioski/* proxy. Leave is universal
// (every role may file/see their own requests — the nav item is visible to everyone, see lib/nav.ts),
// so there is no hard EmptyState/IconLock gate here: <WnioskiScreen roles={roles} /> self-gates its
// MANAGER/HR/ADMIN_KLIENTA-only "Do akceptacji" inbox internally.
export default async function WnioskiPage() {
  const session = await getSession()
  const tenant = { name: '4Mobility sp. z o.o.', slug: '4mobility.hrobot.ai' }
  const user = session?.user ?? { name: 'Użytkownik', role: '—', initials: '?' }
  const roles: Role[] = session?.roles ?? []

  return (
    <AppShell activeHref="/wnioski" title="Wnioski" tenant={tenant} user={user} roles={roles}>
      <WnioskiScreen roles={roles} />
    </AppShell>
  )
}
