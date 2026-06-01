import { MobileNav } from './mobile-drawer'
import { SecuredChip } from '@/components/ui/secured-chip'
import { IconBell } from '@/components/icons'
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
        <button
          type="button"
          aria-label="Powiadomienia"
          className="relative grid place-items-center w-[34px] h-[34px] rounded-lg border border-line-strong bg-card text-muted"
        >
          <span className="absolute top-[7px] right-2 w-1.5 h-1.5 rounded-full bg-accent ring-2 ring-card" />
          <IconBell className="w-[17px] h-[17px]" />
        </button>
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
