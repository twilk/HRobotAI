import { AppShell } from '@/components/layout/app-shell'
import { RaportySummary } from '@/components/raporty/raporty-summary'
import { getHRSummary } from '@/lib/raporty'
import { requirePageSession } from '@/lib/session'

export default async function RaportyPage() {
  const { user, tenant, roles } = await requirePageSession()
  const summary = getHRSummary()

  return (
    <AppShell activeHref="/raporty" title="Raporty" tenant={tenant} user={user} roles={roles}>
      <div className="max-w-[1120px] mx-auto">
        <h1 className="font-display font-extrabold text-3xl tracking-tighter2 text-navy leading-tight">
          Raporty HR
        </h1>
        <p className="text-muted text-[15px] mt-2 max-w-[52ch]">
          Statystyki zbiorcze pracowników, wniosków urlopowych, grafiku i dostępów.
        </p>

        <div className="mt-6">
          <RaportySummary summary={summary} />
        </div>
      </div>
    </AppShell>
  )
}
