import { MobileNav } from './mobile-drawer'
import { SecuredChip } from '@/components/ui/secured-chip'
import { NotificationBell } from '@/components/notifications/notification-bell'
import { SearchBar } from '@/components/search/search-bar'
import { getNotifications, getUnreadCount } from '@/lib/notifications'
import type { Role } from '@/lib/nav'

export interface TopBarProps {
  title: string
  user: { name: string; role: string; initials: string }
  activeHref: string
  roles: Role[]
  tenant: { name: string; slug: string }
}

export function TopBar({ title, user, activeHref, roles, tenant }: TopBarProps) {
  const notifications = getNotifications({ limit: 5 })
  const unreadCount = getUnreadCount()

  return (
    <header className="h-[62px] shrink-0 flex items-center gap-4 px-4 md:px-[26px] border-b border-line bg-canvas sticky top-0 z-10">
      <MobileNav activeHref={activeHref} roles={roles} tenant={tenant} />
      <div className="flex flex-col leading-[1.15]">
        <b className="text-[15px] font-semibold tracking-tightish">{title}</b>
        <span className="font-mono text-[11px] text-muted-2 mt-px">{tenant.slug}</span>
      </div>
      <div className="ml-auto flex items-center gap-3.5">
        <SearchBar />
        <SecuredChip className="hidden sm:inline-flex" />
        <NotificationBell notifications={notifications} unreadCount={unreadCount} />
        <div className="flex items-center gap-2.5 pl-1.5">
          <span className="grid place-items-center w-[34px] h-[34px] rounded-[9px] bg-gradient-to-b from-navy-700 to-navy text-white font-semibold text-[13px]">
            {user.initials}
          </span>
          <div className="hidden sm:block">
            <div className="text-[13px] font-medium leading-tight">{user.name}</div>
            <div className="font-mono text-[9.5px] tracking-[.08em] uppercase text-accent-ink mt-0.5">{user.role}</div>
          </div>
        </div>
      </div>
    </header>
  )
}
