import { AppShell } from '@/components/layout/app-shell'
import { SwapWorkspace } from '@/components/swaps/swap-workspace'
import type { Role } from '@/lib/nav'

/**
 * Zamiany zmian (shift swaps) — the minimal polling UI over the tenant-runtime swap API
 * (M2 #3 §6): "Moje prośby o zamianę" + a propose-swap action + a manager approval inbox.
 * Server Component shell; {@link SwapWorkspace} hydrates for the polling + actions.
 */
export default function ZamianyPage() {
  const tenant = { name: 'ACME Sp. z o.o.', slug: 'acme.hrobot.ai' }
  const user = { name: 'Jan Kowalski', role: 'Admin klienta', initials: 'JK' }
  const roles: Role[] = ['ADMIN_KLIENTA']

  return (
    <AppShell activeHref="/zamiany" title="Zamiany zmian" tenant={tenant} user={user} roles={roles}>
      <SwapWorkspace />
    </AppShell>
  )
}
