import { AppShell } from '@/components/layout/app-shell'
import { requirePageSession } from '@/lib/session'
import { getAllAccessSummaries } from '@/lib/dostepy'
import { DostepyClientView } from '@/components/dostepy/dostepy-client-view'

export default async function DostepyPage() {
  const { user, tenant, roles } = await requirePageSession()
  const initialData = getAllAccessSummaries()
  return (
    <AppShell activeHref="/dostepy" title="Dostępy" tenant={tenant} user={user} roles={roles}>
      <DostepyClientView initialData={initialData} />
    </AppShell>
  )
}
