import type { ComponentType, SVGProps } from 'react'
import {
  IconDashboard,
  IconUsers,
  IconCalendar,
  IconRequests,
  IconKey,
  IconSettings,
  IconUser,
  IconSparkles,
  IconFileText,
  IconMessageCircle,
  IconChart,
} from '@/components/icons'

export type Role = 'PRACOWNIK' | 'MANAGER' | 'HR' | 'ADMIN_KLIENTA'
type Icon = ComponentType<SVGProps<SVGSVGElement>>

export interface NavItem {
  label: string
  href: string
  icon: Icon
  tag?: string
  /** Render with an accent treatment so a flagship module stands out from the plain items. */
  highlight?: boolean
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
      {
        // Manager-only again (product decision, restoring the SP0 locked scope): the employee's own
        // AI replacement-consent section moved to /zamiany (PRACOWNIK-visible), so this page — config
        // + manager inbox + scan trigger — no longer needs to be reachable by a plain PRACOWNIK.
        label: 'AI Grafik Manager',
        href: '/ai-grafik-manager',
        icon: IconSparkles,
        tag: 'AI',
        highlight: true,
        roles: ['MANAGER', 'HR', 'ADMIN_KLIENTA'],
      },
      { label: 'Zamiany', href: '/zamiany', icon: IconRequests },
      // Bez statycznego licznika ('3' było hardkodem, nie odzwierciedlało realnej liczby wniosków —
      // mylące). Realny badge = dynamiczny licznik PENDING; do czasu jego wpięcia lepiej bez tagu.
      { label: 'Wnioski', href: '/wnioski', icon: IconRequests },
      { label: 'Dostępy', href: '/dostepy', icon: IconKey, roles: ['MANAGER', 'HR', 'ADMIN_KLIENTA'] },
      // Moduł Dokumenty (M3, SPEC §7). A plain PRACOWNIK still reaches /dokumenty by direct
      // navigation (the page shows a read-only "moja ewidencja" branch via /dokumenty/mine — see
      // app/(tenant)/dokumenty/page.tsx) — this gate only hides the SIDEBAR entry, mirroring how
      // /dostepy is gated here.
      { label: 'Dokumenty', href: '/dokumenty', icon: IconFileText, roles: ['MANAGER', 'HR', 'ADMIN_KLIENTA'] },
      // Agent Głosowy (M3 module 3) — a text/voice command assistant that always acts AS the caller
      // (self, no escalation; ANY_ROLE gate on AgentGlosowyController). No `roles` restriction — every
      // authenticated role sees this entry, unlike Dostępy/Dokumenty above which hide from PRACOWNIK.
      { label: 'Asystent', href: '/asystent', icon: IconMessageCircle, tag: 'AI' },
      // M3 Analityk HR: aggregate workforce analytics, so a plain PRACOWNIK never sees the entry
      // (the tenant-runtime @Roles gate answers them with a 403 regardless).
      { label: 'Analityk HR', href: '/analityk', icon: IconChart, roles: ['MANAGER', 'HR', 'ADMIN_KLIENTA'] },
      // „Strategiczny mózg kadrowy” (backend `strategic-brain`) — moduł opisany w KM3 §3.2 jako
      // Analityk HR: cztery wymiary oceny, trajektoria rozwoju, sygnały retencji i rekomendacje
      // rekrutacji, każda z twardą granicą art. 22 RODO.
      //
      // DLACZEGO DOPISANE. Do 2026-08-10 ta trasa NIE MIAŁA pozycji w menu i była osiągalna wyłącznie
      // przez ręczne wpisanie adresu — czyli moduł rozliczany w grancie był praktycznie niewidoczny,
      // a pozycja „Analityk HR” powyżej prowadzi do INNEGO ekranu (operacyjnego pulpitu KPI).
      //
      // Etykieta celowo równa tytułowi, który strona ustawia w topbarze (`title="Analiza rozwoju"`),
      // żeby menu i nagłówek mówiły to samo. BEZ ograniczenia ról: każda rola ma tu sensowny widok —
      // HR/ADMIN pełny przegląd, MANAGER zawężony do swoich jednostek, a PRACOWNIK WYŁĄCZNIE własną
      // kartę (`SelfCard` przez `/employee/me`), nigdy cudzą. Scoping egzekwuje backend, nie to menu.
      { label: 'Analiza rozwoju', href: '/analiza', icon: IconSparkles, tag: 'AI' },
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
