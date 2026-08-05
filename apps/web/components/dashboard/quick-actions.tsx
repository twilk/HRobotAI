import Link from 'next/link'
import type { ComponentType, SVGProps } from 'react'
import { Card } from '@/components/ui/card'
import { IconUserPlus, IconCalendar, IconMail, IconRequests, IconArrowRight } from '@/components/icons'
import type { Role } from '@/lib/nav'

interface Action {
  title: string
  desc: string
  href: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
}

const PRACOWNIK_ACTIONS: Action[] = [
  { title: 'Mój grafik', desc: 'Zobacz swoje nadchodzące zmiany i godziny pracy.', href: '/grafik', icon: IconCalendar },
  { title: 'Złóż wniosek', desc: 'Wyślij wniosek urlopowy lub inny do akceptacji.', href: '/wnioski', icon: IconRequests },
]

const MANAGER_ACTIONS: Action[] = [
  { title: 'Skonfiguruj grafik', desc: 'Zaplanuj zmiany, dyżury i godziny pracy zespołu.', href: '/grafik', icon: IconCalendar },
  { title: 'Wnioski do akceptacji', desc: 'Zatwierdź lub odrzuć wnioski oczekujące zespołu.', href: '/wnioski', icon: IconRequests },
  { title: 'Zamiany', desc: 'Przejrzyj propozycje zamian i zastępstw.', href: '/zamiany', icon: IconRequests },
]

const HR_ACTIONS: Action[] = [
  { title: 'Dodaj pracownika', desc: 'Zacznij budować swój zespół i kartoteki kadrowe.', href: '/pracownicy', icon: IconUserPlus },
  { title: 'Skonfiguruj grafik', desc: 'Zaplanuj zmiany, dyżury i godziny pracy zespołu.', href: '/grafik', icon: IconCalendar },
]

const ADMIN_ACTIONS: Action[] = [
  { title: 'Dodaj pracownika', desc: 'Zacznij budować swój zespół i kartoteki kadrowe.', href: '/pracownicy', icon: IconUserPlus },
  { title: 'Skonfiguruj grafik', desc: 'Zaplanuj zmiany, dyżury i godziny pracy zespołu.', href: '/grafik', icon: IconCalendar },
  { title: 'Zaproś użytkowników', desc: 'Dodaj HR i menedżerów do przestrzeni roboczej.', href: '/ustawienia/uzytkownicy', icon: IconMail },
]

/**
 * Actions offered for the caller's roles — mirrors nav.ts's RBAC-visibility convention but for the
 * dashboard's shortcut tiles. Fixes the bug where a plain PRACOWNIK saw all 3 admin shortcuts
 * (worst case "Zaproś użytkowników" dead-ends at "Brak dostępu"; see
 * docs/superpowers/specs/2026-07-14-role-dashboards-component-audit.md §A/§E-2). Priority:
 * ADMIN_KLIENTA > HR > MANAGER > PRACOWNIK (a user with multiple roles gets the highest tier's set).
 */
export function actionsForRoles(roles: Role[]): Action[] {
  const isAdmin = roles.includes('ADMIN_KLIENTA')
  const isGlobal = isAdmin || roles.includes('HR')
  const canManage = isGlobal || roles.includes('MANAGER')

  if (isAdmin) return ADMIN_ACTIONS
  if (isGlobal) return HR_ACTIONS
  if (canManage) return MANAGER_ACTIONS
  return PRACOWNIK_ACTIONS
}

export function QuickActions({ roles }: { roles: Role[] }) {
  const actions = actionsForRoles(roles)
  return (
    <div className="grid sm:grid-cols-3 gap-4">
      {actions.map((a) => {
        const Icon = a.icon
        return (
          <Link key={a.href} href={a.href} className="group">
            <Card className="h-full p-[18px] flex flex-col gap-3 transition-[transform,box-shadow,border-color] duration-150 group-hover:-translate-y-0.5 group-hover:shadow group-hover:border-line-strong">
              <span className="grid place-items-center w-10 h-10 rounded-[10px] border border-line bg-card-2">
                <Icon className="w-5 h-5 text-accent-ink" />
              </span>
              <h3 className="text-[15.5px] font-semibold tracking-tightish">{a.title}</h3>
              <p className="text-[13px] text-muted leading-snug">{a.desc}</p>
              <span className="mt-0.5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent-ink">
                Przejdź
                <IconArrowRight className="w-[15px] h-[15px] transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
              </span>
            </Card>
          </Link>
        )
      })}
    </div>
  )
}
