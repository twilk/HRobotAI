import { MobileNav } from './mobile-drawer'
import { UserMenu } from './user-menu'
import { NotificationsMenu } from './notifications-menu'
import { SecuredChip } from '@/components/ui/secured-chip'
import { TourTrigger } from '@/components/tour/tour'
import type { Role } from '@/lib/nav'

export interface TopBarProps {
  title: string
  user: { name: string; role: string; initials: string }
  activeHref: string
  roles: Role[]
  tenant: { name: string; slug: string }
}

export function TopBar({ title, user, activeHref, roles, tenant }: TopBarProps) {
  return (
    <header className="h-[62px] shrink-0 flex items-center gap-4 px-4 md:px-[26px] border-b border-line bg-canvas sticky top-0 z-10">
      <MobileNav activeHref={activeHref} roles={roles} tenant={tenant} />
      <div className="flex flex-col leading-[1.15]">
        <b className="text-[15px] font-semibold tracking-tightish">{title}</b>
        <span className="font-mono text-[11px] text-muted-2 mt-px">{tenant.slug}</span>
      </div>
      <div className="ml-auto flex items-center gap-3.5">
        <SecuredChip className="hidden sm:inline-flex" />
        {/* G5: gotowy przewodnik po produkcie, wcześniej zbudowany lecz niewpięty w topbar. */}
        <TourTrigger className="hidden md:inline-flex" />
        {/* G2: realny panel powiadomień (kropka odzwierciedla liczbę pozycji do decyzji). */}
        <NotificationsMenu />
        {/* G1: klikalne menu konta z „Mój profil" + „Wyloguj" (wcześniej martwa ikona/avatar). */}
        <UserMenu name={user.name} role={user.role} initials={user.initials} />
      </div>
    </header>
  )
}
