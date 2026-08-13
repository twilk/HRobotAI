import { SidebarNav, type SidebarNavProps } from './sidebar-nav'

/** Desktop rail (hidden under md; the mobile drawer takes over). */
export function Sidebar(props: SidebarNavProps) {
  return (
    <aside className="hidden md:flex w-[268px] shrink-0 flex-col bg-navy text-nav-text border-r border-navy-900">
      <SidebarNav {...props} />
    </aside>
  )
}
