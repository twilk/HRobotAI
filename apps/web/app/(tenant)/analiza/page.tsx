import { AppShell } from '@/components/layout/app-shell'
import { RodoBanner } from '@/components/strategic-brain/rodo-banner'
import { StrategicOverview } from '@/components/strategic-brain/overview'
import { SelfCard } from '@/components/strategic-brain/self-card'
import type { Role } from '@/lib/nav'
import { getSession } from '@/lib/session'

/**
 * "Strategiczny mózg kadrowy" — the Analiza screen (spec §8). Server shell: identity via
 * `getSession` (the decoded `hrobot_token` claim, same as every tenant page), AppShell, and the
 * RBAC gate. This is NOT the grafik — it's the continuous, explainable analysis of performance,
 * timeliness, quality AND development trajectory, with proactive retention + recruitment
 * recommendations that a human always approves (art. 22 RODO).
 *
 * RBAC (mirrors the tenant-runtime controller's role gate; real scoping is enforced server-side, M16):
 *   - HR / ADMIN_KLIENTA (isGlobal)  -> full overview (every employee, config-aware, may acknowledge).
 *   - MANAGER (canManage, !isGlobal) -> the SAME overview, but the API returns only their managed
 *                                       units and hides the acknowledge action (scope='manager').
 *   - PRACOWNIK (else)               -> ONLY their own card via /employee/me — never anyone else's.
 * The RODO banner is rendered ONCE here, above every branch, so it is present on every view.
 */
export default async function AnalizaPage() {
  const session = await getSession()
  const tenant = { name: '4Mobility sp. z o.o.', slug: '4mobility.hrobot.ai' }
  const user = session?.user ?? { name: 'Użytkownik', role: '—', initials: '?' }
  const roles: Role[] = session?.roles ?? []
  const firstName = user.name.split(' ')[0]

  const isGlobal = roles.includes('ADMIN_KLIENTA') || roles.includes('HR')
  const canManage = isGlobal || roles.includes('MANAGER')

  return (
    <AppShell activeHref="/analiza" title="Analiza rozwoju" tenant={tenant} user={user} roles={roles}>
      <div className="mx-auto max-w-[1120px]">
        <h1 className="font-display text-3xl font-extrabold leading-tight tracking-tighter2 text-navy">
          Strategiczny mózg <span className="text-accent-ink">kadrowy</span>
        </h1>
        <p className="mt-2 max-w-[56ch] text-[15px] text-muted">
          {isGlobal
            ? `${firstName}, oto ciągła analiza wydajności i trajektorii rozwoju zespołu — z proaktywnymi rekomendacjami retencji i rekrutacji. To nie grafik, to strategia.`
            : canManage
              ? `${firstName}, analiza rozwoju Twojego zespołu — sygnały retencji i rekomendacje rekrutacji dla Twoich jednostek.`
              : `${firstName}, Twoja analiza rozwoju — wynik, trajektoria i co ją napędza. Przejrzyście, zgodnie z RODO.`}
        </p>

        <div className="mt-5">
          <RodoBanner />
        </div>

        <div className="mt-6">
          {canManage ? (
            <StrategicOverview scope={isGlobal ? 'global' : 'manager'} />
          ) : (
            <SelfCard name={user.name} />
          )}
        </div>
      </div>
    </AppShell>
  )
}
