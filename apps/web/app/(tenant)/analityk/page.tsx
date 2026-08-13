import { AppShell } from '@/components/layout/app-shell'
import { AnalitykDashboard } from '@/components/analityk/dashboard'
import { EmptyState } from '@/components/ui/empty-state'
import { IconLock } from '@/components/icons'
import type { Role } from '@/lib/nav'
import { getTenant } from '@/lib/tenant'
import { getSession } from '@/lib/session'

/**
 * "Analityk HR" — the M3 workforce-analytics screen. Server shell: identity via `getSession` (the
 * decoded `hrobot_token` claim, same as every tenant page), AppShell, and the RBAC gate; the
 * dashboard itself is a client component that loads real aggregates from the tenant-runtime
 * `analityk` controller through the same-origin proxy.
 *
 * RBAC (mirrors the tenant-runtime `@Roles` gate — the real enforcement is server-side):
 *   - HR / ADMIN_KLIENTA (isGlobal)  -> the whole tenant.
 *   - MANAGER (canManage, !isGlobal) -> the same screen, but the API returns only their units.
 *   - PRACOWNIK (else)               -> NO access; aggregate workforce analytics is not
 *                                       self-service data. The gate below is a courtesy message —
 *                                       the API answers a PRACOWNIK with a 403 regardless.
 */
export default async function AnalitykPage() {
  const session = await getSession()
  const tenant = await getTenant()
  const user = session?.user ?? { name: 'Użytkownik', role: '—', initials: '?' }
  const roles: Role[] = session?.roles ?? []
  const firstName = user.name.split(' ')[0]

  const isGlobal = roles.includes('ADMIN_KLIENTA') || roles.includes('HR')
  const canManage = isGlobal || roles.includes('MANAGER')

  return (
    <AppShell activeHref="/analityk" title="Analityk HR" tenant={tenant} user={user} roles={roles}>
      <div className="mx-auto max-w-[1120px]">
        <h1 className="font-display text-3xl font-extrabold leading-tight tracking-tighter2 text-navy">
          Analityk <span className="text-accent-ink">HR</span>
        </h1>
        <p className="mt-2 max-w-[62ch] text-[15px] text-muted">
          {isGlobal
            ? `${firstName}, oto stan kadr w liczbach — zatrudnienie, absencje, czas pracy, urlopy i przepustowość wniosków. Wszystko liczone na bieżących danych z systemu, nie na szacunkach.`
            : canManage
              ? `${firstName}, kadry Twoich jednostek w liczbach — zatrudnienie, absencje, czas pracy, urlopy i kolejki wniosków.`
              : `${firstName}, ten moduł prezentuje zbiorcze dane kadrowe całych zespołów.`}
        </p>

        <div className="mt-6">
          {canManage ? (
            <AnalitykDashboard />
          ) : (
            <EmptyState icon={IconLock} title="Brak dostępu do analityki kadrowej">
              Zbiorcze wskaźniki kadrowe są dostępne dla działu HR, administratora i kierowników jednostek. Swoje własne
              dane znajdziesz w zakładkach Grafik oraz Wnioski.
            </EmptyState>
          )}
        </div>
      </div>
    </AppShell>
  )
}
