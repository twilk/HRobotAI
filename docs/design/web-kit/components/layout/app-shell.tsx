import type { ReactNode } from 'react'
import { Sidebar } from './sidebar'
import { TopBar } from './topbar'
import type { Role } from '@/lib/nav'

export interface AppShellProps {
  children: ReactNode
  /** Current route, used for active nav + RBAC. */
  activeHref: string
  title: string
  tenant: { name: string; slug: string }
  user: { name: string; role: string; initials: string }
  roles: Role[]
}

/** Navy rail + warm main. Server Component; only the mobile drawer hydrates. */
export function AppShell({ children, activeHref, title, tenant, user, roles }: AppShellProps) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar activeHref={activeHref} roles={roles} tenant={tenant} />
      <div className="flex flex-1 flex-col min-w-0">
        <TopBar title={title} user={user} activeHref={activeHref} roles={roles} tenant={tenant} />
        <main className="flex-1 overflow-y-auto px-5 md:px-10 py-8 pb-14">{children}</main>
      </div>
    </div>
  )
}
