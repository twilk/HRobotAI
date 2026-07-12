import { AppShell } from '@/components/layout/app-shell'
import { GrafikScreen } from '@/components/grafik/grafik-screen'
import type { Role } from '@/lib/nav'
import { getSession } from '@/lib/session'

// Server shell (identity/AppShell); the grid itself is a Client Component that fetches the weekly
// schedule from the REAL tenant-runtime grafik API through the /api/grafik/* proxy routes, offers
// "Generuj grafik" (POST /grafik/solve, A4) and manual shift CRUD (A3). Identity comes from the real
// Keycloak session (lib/session).
export default async function GrafikPage() {
  const session = await getSession()
  const tenant = { name: '4Mobility sp. z o.o.', slug: '4mobility.hrobot.ai' }
  const user = session?.user ?? { name: 'Użytkownik', role: '—', initials: '?' }
  const roles: Role[] = session?.roles ?? []

  return (
    <AppShell activeHref="/grafik" title="Grafik" tenant={tenant} user={user} roles={roles}>
      <GrafikScreen />
    </AppShell>
  )
}
