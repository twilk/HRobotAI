import { AppShell } from '@/components/layout/app-shell'
import { FacilityConfig } from '@/components/facilities/facility-config'
import { getFacilities } from '@/lib/facilities'
import { requirePageSession } from '@/lib/session'

export default async function PlacowkiPage() {
  const { user, tenant, roles } = await requirePageSession()

  return (
    <AppShell activeHref="/ustawienia/placowki" title="Placówki" tenant={tenant} user={user} roles={roles}>
      <div className="mx-auto max-w-[1120px]">
        <div className="mb-[22px]">
          <h1 className="font-display text-[26px] font-extrabold leading-tight tracking-tightish text-navy">Placówki</h1>
          <p className="mt-1.5 text-sm text-muted">
            Lokalizacje, adresy oraz dni i godziny pracy. Te ustawienia sterują grafikiem.
          </p>
        </div>
        <FacilityConfig facilities={getFacilities()} />
      </div>
    </AppShell>
  )
}
