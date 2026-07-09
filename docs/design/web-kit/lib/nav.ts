import type { ComponentType, SVGProps } from 'react'
import {
  IconDashboard,
  IconUsers,
  IconCalendar,
  IconRequests,
  IconKey,
  IconSettings,
  IconUser,
} from '@/components/icons'

export type Role = 'PRACOWNIK' | 'MANAGER' | 'HR' | 'ADMIN_KLIENTA'
type Icon = ComponentType<SVGProps<SVGSVGElement>>

export interface NavItem {
  label: string
  href: string
  icon: Icon
  tag?: string
  /** Visible only to these roles. Undefined = visible to everyone. */
  roles?: Role[]
}
export interface NavGroup {
  label: string
  items: NavItem[]
}

export const NAV: NavGroup[] = [
  {
    label: 'Moduły HR',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: IconDashboard },
      { label: 'Pracownicy', href: '/pracownicy', icon: IconUsers },
      { label: 'Grafik', href: '/grafik', icon: IconCalendar },
      { label: 'Zamiany', href: '/zamiany', icon: IconRequests },
      { label: 'Wnioski', href: '/wnioski', icon: IconRequests, tag: '3' },
      { label: 'Dostępy', href: '/dostepy', icon: IconKey, roles: ['MANAGER', 'HR', 'ADMIN_KLIENTA'] },
    ],
  },
  {
    label: 'Administracja',
    items: [
      { label: 'Ustawienia', href: '/ustawienia', icon: IconSettings, roles: ['ADMIN_KLIENTA'] },
      { label: 'Użytkownicy', href: '/ustawienia/uzytkownicy', icon: IconUser, roles: ['ADMIN_KLIENTA'] },
    ],
  },
]

/** Filter nav by the current user's roles (RBAC-visibility-aware). */
export function visibleGroups(roles: Role[]): NavGroup[] {
  const can = (item: NavItem) => !item.roles || item.roles.some((r) => roles.includes(r))
  return NAV.map((g) => ({ ...g, items: g.items.filter(can) })).filter((g) => g.items.length > 0)
}
