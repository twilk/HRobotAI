import { MobileWeek } from '@/components/moj-tydzien/mobile-week'
import { getSession } from '@/lib/session'
import { getTenant } from '@/lib/tenant'

/**
 * `/moj-tydzien` — the employee's phone route.
 *
 * DELIBERATELY NOT INSIDE AppShell. AppShell is the desktop chrome: a fixed sidebar, a topbar with
 * tenant switcher and notifications, and several hardcoded pixel widths. On a 375px screen it costs
 * most of the viewport to render navigation to eleven screens a shift worker has no reason to open.
 * This page renders its own minimal shell instead — the tenant name, the content, and one link back
 * to the full app for anyone who lands here on a laptop.
 *
 * SCOPE. Two answers: when am I working this week, and can I ask for time off. Nothing else. The
 * other eleven tenant screens remain desktop-only; whether this route earns more is a question the
 * usage events (lib/usage-log.ts) can answer with evidence rather than assumption.
 */
export default async function MojTydzienPage() {
  const session = await getSession()
  const tenant = await getTenant()
  const user = session?.user ?? { name: 'Użytkownik', role: '—', initials: '?' }

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-card px-4 py-3">
        <div className="mx-auto flex max-w-[560px] items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-navy">{tenant.name}</p>
            <p className="truncate text-[11.5px] text-muted-2">{user.name}</p>
          </div>
          <a
            href="/dashboard"
            className="grid min-h-[44px] shrink-0 place-items-center rounded-sm px-3 text-[13px] text-muted underline underline-offset-2"
          >
            Pełny widok
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-[560px] px-4 py-5">
        <MobileWeek />
      </main>
    </div>
  )
}
