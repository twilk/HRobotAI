import { AppShell } from '@/components/layout/app-shell'
import { WnioskiClientView } from '@/components/wnioski/wnioski-client-view'
import { getLeaveRequests } from '@/lib/wnioski'
import { getAllLeaveBalances } from '@/lib/leave-balance'
import { requirePageSession } from '@/lib/session'

export default async function WnioskiPage() {
  const { user, tenant, roles } = await requirePageSession()
  const initialRequests = getLeaveRequests()
  const balances = getAllLeaveBalances()

  return (
    <AppShell activeHref="/wnioski" title="Wnioski" tenant={tenant} user={user} roles={roles}>
      <WnioskiClientView initialRequests={initialRequests} balances={balances} />
    </AppShell>
  )
}
