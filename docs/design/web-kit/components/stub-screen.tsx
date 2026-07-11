import type { ComponentType, SVGProps } from 'react'
import { AppShell } from '@/components/layout/app-shell'
import { EmptyState } from '@/components/ui/empty-state'
import type { Role } from '@/lib/nav'

const tenant = { name: '4Mobility sp. z o.o.', slug: '4mobility.hrobot.ai' }
const user = { name: 'Jan Kowalski', role: 'Admin klienta', initials: 'JK' }
const roles: Role[] = ['ADMIN_KLIENTA']

/** Functional "visible future intent" stub: full shell + a crafted empty state. */
export function StubScreen({
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
  return (
    <AppShell activeHref={activeHref} title={title} tenant={tenant} user={user} roles={roles}>
      <EmptyState icon={icon} title={heading}>
        {body}
      </EmptyState>
    </AppShell>
  )
}
