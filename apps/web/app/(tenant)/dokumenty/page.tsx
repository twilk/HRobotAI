import { AppShell } from '@/components/layout/app-shell'
import { DokumentyRodoBanner } from '@/components/dokumenty/rodo-banner'
import { DokumentyScreen } from '@/components/dokumenty/dokumenty-screen'
import { MojaEwidencjaScreen } from '@/components/dokumenty/moja-ewidencja-screen'
import type { Role } from '@/lib/nav'
import { getTenant } from '@/lib/tenant'
import { getSession } from '@/lib/session'

/**
 * Moduł Dokumenty (M3) screen (SPEC §7). Server shell: identity via `getSession`, AppShell, and the
 * RBAC gate — mirrors app/(tenant)/analiza/page.tsx and app/(tenant)/dostepy/page.tsx.
 *
 * RBAC (real enforcement is server-side in DokumentyController/-Service, M16):
 *   - MANAGER / HR / ADMIN_KLIENTA -> the full workspace (list in their scope, generuj, zatwierdz,
 *     pobierz). HR/ADMIN_KLIENTA are GLOBAL (see every document, may target scopeType=ALL); MANAGER
 *     is limited server-side to their managed units.
 *   - PRACOWNIK (anyone else, including no session)       -> ONLY their own EWIDENCJA_CZASU_PRACY via
 *     `/dokumenty/mine`, read-only (DECYZJA-4M #6). `lib/nav.ts` hides the sidebar entry for a plain
 *     PRACOWNIK (mirroring /dostepy's gating), but direct navigation still resolves to this read-only
 *     view rather than a hard lock-out — unlike /dostepy, a PRACOWNIK has a legitimate self-service
 *     use of this route.
 * The RODO banner (art. 22 — a human approves/sends, never the module) is rendered ONCE here, above
 * every branch, so it is present on every view.
 */
export default async function DokumentyPage() {
  const session = await getSession()
  const tenant = await getTenant()
  const user = session?.user ?? { name: 'Użytkownik', role: '—', initials: '?' }
  const roles: Role[] = session?.roles ?? []
  const firstName = user.name.split(' ')[0]

  const canManage = roles.some((r) => r === 'MANAGER' || r === 'HR' || r === 'ADMIN_KLIENTA')

  return (
    <AppShell activeHref="/dokumenty" title="Dokumenty" tenant={tenant} user={user} roles={roles}>
      <div className="mx-auto max-w-[1120px]">
        <h1 className="font-display text-3xl font-extrabold leading-tight tracking-tighter2 text-navy">
          Dokumenty <span className="text-accent-ink">kadrowo-płacowe</span>
        </h1>
        <p className="mt-2 max-w-[62ch] text-[15px] text-muted">
          {canManage
            ? `${firstName}, generuj ewidencję czasu pracy, nadgodziny i eksport ZUS/Płatnik z danych RCP — każdy krok o skutkach prawnych zatwierdzasz Ty.`
            : `${firstName}, Twoja ewidencja czasu pracy — do wglądu i pobrania.`}
        </p>

        <div className="mt-5">
          <DokumentyRodoBanner />
        </div>

        <div className="mt-6">{canManage ? <DokumentyScreen /> : <MojaEwidencjaScreen />}</div>
      </div>
    </AppShell>
  )
}
