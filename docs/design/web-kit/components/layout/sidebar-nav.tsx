import Link from 'next/link'
import { BrandMark, Wordmark } from '@/components/ui/brand-mark'
import { IconShieldCheck } from '@/components/icons'
import { visibleGroups, type Role } from '@/lib/nav'
import { cn } from '@/lib/cn'

export interface SidebarNavProps {
  activeHref: string
  roles: Role[]
  tenant: { name: string; slug: string }
}

/** Brand + grouped nav + EU footer. Shared by the desktop rail and the mobile drawer. */
export function SidebarNav({ activeHref, roles, tenant }: SidebarNavProps) {
  return (
    <>
      <div className="motif-brand px-[22px] pt-[22px] pb-[18px] border-b border-white/[0.07]">
        <div className="relative flex items-center gap-[11px]">
          <BrandMark />
          <Wordmark />
        </div>
        <div className="relative mt-3.5">
          <div className="text-[13.5px] font-medium text-[#E4EAF3]">{tenant.name}</div>
          <div className="font-mono text-[11.5px] text-[#7E8DA6] mt-0.5">{tenant.slug}</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-3">
        {visibleGroups(roles).map((group) => (
          <div key={group.label} className="mb-1.5">
            <div className="font-mono text-[10.5px] tracking-[.14em] uppercase text-nav-dim px-3 pt-2.5 pb-2">
              {group.label}
            </div>
            {group.items.map((item) => {
              const active = activeHref === item.href || activeHref.startsWith(item.href + '/')
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-[11px] px-3 py-[9px] my-px rounded-lg text-sm font-medium border-l-2 border-transparent transition-colors',
                    active
                      ? 'bg-accent-navy/10 text-white border-l-accent-navy'
                      : 'text-nav-text hover:bg-white/[0.04] hover:text-[#DCE3EE]',
                  )}
                >
                  <Icon className={cn('w-[18px] h-[18px] shrink-0', active ? 'text-accent-navy' : 'text-[#7E8DA6]')} />
                  {item.label}
                  {item.tag ? (
                    <span className="ml-auto font-mono text-[10px] text-nav-dim border border-white/10 px-1.5 rounded-full">
                      {item.tag}
                    </span>
                  ) : null}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="flex items-center gap-[9px] px-[18px] py-3.5 border-t border-white/[0.07]">
        <IconShieldCheck className="w-[15px] h-[15px] text-verified" strokeWidth={1.7} />
        <span className="text-xs text-[#9AA8BD]">Dane chronione w UE</span>
        <span className="ml-auto font-mono text-[10.5px] text-nav-dim">EU-CENTRAL</span>
      </div>
    </>
  )
}
