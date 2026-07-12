import { AppShell } from '@/components/layout/app-shell'
import { SwapWorkspace } from '@/components/swaps/swap-workspace'
import type { Role } from '@/lib/nav'
import { getSession } from '@/lib/session'

/**
 * Zamiany zmian (shift swaps) — the minimal polling UI over the tenant-runtime swap API
 * (M2 #3 §6): "Moje prośby o zamianę" + a propose-swap action + a manager approval inbox.
 * Server Component shell; {@link SwapWorkspace} hydrates for the polling + actions.
 */
export default async function ZamianyPage() {
  const session = await getSession()
  const tenant = { name: '4Mobility sp. z o.o.', slug: '4mobility.hrobot.ai' }
  const user = session?.user ?? { name: 'Użytkownik', role: '—', initials: '?' }
  const roles: Role[] = session?.roles ?? []

  return (
    <AppShell activeHref="/zamiany" title="Zamiany zmian" tenant={tenant} user={user} roles={roles}>
      <SwapWorkspace />
    </AppShell>
  )
}
