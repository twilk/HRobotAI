import type { ComponentType, SVGProps } from 'react'
import { AppShell } from '@/components/layout/app-shell'
import { EmptyState } from '@/components/ui/empty-state'
import type { Role } from '@/lib/nav'
import { getTenant } from '@/lib/tenant'
import { getSession } from '@/lib/session'

/**
 * Functional "visible future intent" stub: full shell + a crafted empty state.
 * Identity/nav MUST come from the real session — a hardcoded admin user here leaked the
 * ADMIN_KLIENTA identity + ADMINISTRACJA nav to every logged-in user (F1). Async server component.
 *
 * `tenant` is resolved INSIDE the component, not at module scope: a module-level await would bind
 * one tenant for the lifetime of the server process and hand it to every other tenant that renders
 * a stub — the same cross-tenant identity bug this file used to have with a hardcoded literal.
 */
export async function StubScreen({
  activeHref,
  title,
  icon,
  heading,
  body,
}: {
  activeHref: string
  title: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  heading: string
  body: string
}) {
  const session = await getSession()
  const tenant = await getTenant()
  const user = session?.user ?? { name: 'Użytkownik', role: '—', initials: '?' }
  const roles: Role[] = session?.roles ?? []

  return (
    <AppShell activeHref={activeHref} title={title} tenant={tenant} user={user} roles={roles}>
      <EmptyState icon={icon} title={heading}>
        {body}
      </EmptyState>
    </AppShell>
  )
}
