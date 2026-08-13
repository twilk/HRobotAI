import { AppShell } from '@/components/layout/app-shell'
import { AiNoticeBanner } from '@/components/asystent/ai-notice-banner'
import { AsystentScreen } from '@/components/asystent/asystent-screen'
import type { Role } from '@/lib/nav'
import { getTenant } from '@/lib/tenant'
import { getSession } from '@/lib/session'

/**
 * Asystent (Agent Głosowy, M3 module 3) screen — a TEXT-first command assistant. Server shell:
 * identity via `getSession`, AppShell, no RBAC branching (mirrors app/(tenant)/analiza/page.tsx's
 * shell shape, but this module has none of that screen's role split) — every authenticated role
 * reaches the SAME workspace, because the agent always acts AS the caller (self, no escalation; see
 * `AgentGlosowyController`'s `ANY_ROLE` gate and `VoiceCommandService`'s doc comment).
 *
 * The EU AI Act transparency banner is rendered ONCE here, above the interactive screen, so it is
 * present on every view regardless of what the user has typed.
 */
export default async function AsystentPage() {
  const session = await getSession()
  const tenant = await getTenant()
  const user = session?.user ?? { name: 'Użytkownik', role: '—', initials: '?' }
  const roles: Role[] = session?.roles ?? []
  const firstName = user.name.split(' ')[0]

  return (
    <AppShell activeHref="/asystent" title="Asystent" tenant={tenant} user={user} roles={roles}>
      <div className="mx-auto max-w-[1120px]">
        <h1 className="font-display text-3xl font-extrabold leading-tight tracking-tighter2 text-navy">
          Asystent <span className="text-accent-ink">głosowy</span>
        </h1>
        <p className="mt-2 max-w-[62ch] text-[15px] text-muted">
          {firstName}, wpisz polecenie po polsku — np. wniosek urlopowy albo pytanie o Twój grafik — a
          asystent zaproponuje, co zrobić. Nic zapisującego nie wykona bez Twojego potwierdzenia.
        </p>

        <div className="mt-5">
          <AiNoticeBanner />
        </div>

        <div className="mt-6">
          <AsystentScreen />
        </div>
      </div>
    </AppShell>
  )
}
