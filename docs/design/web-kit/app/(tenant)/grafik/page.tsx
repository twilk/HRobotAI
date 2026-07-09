import { AppShell } from '@/components/layout/app-shell'
import { GrafikScreen } from '@/components/grafik/grafik-screen'
import type { Role } from '@/lib/nav'

// Server shell (identity/AppShell); the grid itself is a Client Component that fetches the weekly
// schedule from the REAL tenant-runtime grafik API through the /api/grafik/* proxy routes, offers
// "Generuj grafik" (POST /grafik/solve, A4) and manual shift CRUD (A3). Identity is placeholder
// until web-kit gets a Keycloak/Auth.js session (see PR body) — same pattern as the other pages.
export default function GrafikPage() {
  const tenant = { name: 'ACME Sp. z o.o.', slug: 'acme.hrobot.ai' }
  const user = { name: 'Jan Kowalski', role: 'Admin klienta', initials: 'JK' }
  const roles: Role[] = ['ADMIN_KLIENTA']

  return (
    <AppShell activeHref="/grafik" title="Grafik" tenant={tenant} user={user} roles={roles}>
      <GrafikScreen />
    </AppShell>
  )
}
