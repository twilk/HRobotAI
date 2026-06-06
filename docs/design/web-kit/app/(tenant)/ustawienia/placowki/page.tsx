import { AppShell } from '@/components/layout/app-shell'
import { FacilityConfig } from '@/components/facilities/facility-config'
import { getFacilities } from '@/lib/facilities'
import type { Role } from '@/lib/nav'

export default async function PlacowkiPage() {
  const tenant = { name: 'ACME Sp. z o.o.', slug: 'acme.hrobot.ai' }
  const user = { name: 'Jan Kowalski', role: 'Admin klienta', initials: 'JK' }
  const roles: Role[] = ['ADMIN_KLIENTA']

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
