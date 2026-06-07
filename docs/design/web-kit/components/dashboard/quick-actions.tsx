import Link from 'next/link'
import type { ComponentType, SVGProps } from 'react'
import { Card } from '@/components/ui/card'
import { IconUserPlus, IconCalendar, IconMail, IconArrowRight } from '@/components/icons'

interface Action {
  title: string
  desc: string
  href: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
}

const ACTIONS: Action[] = [
  { title: 'Dodaj pracownika', desc: 'Zacznij budować swój zespół i kartoteki kadrowe.', href: '/pracownicy', icon: IconUserPlus },
  { title: 'Skonfiguruj grafik', desc: 'Zaplanuj zmiany, dyżury i godziny pracy zespołu.', href: '/grafik', icon: IconCalendar },
  { title: 'Zaproś użytkowników', desc: 'Dodaj HR i menedżerów do przestrzeni roboczej.', href: '/ustawienia/uzytkownicy', icon: IconMail },
]

export function QuickActions() {
  return (
    <div className="grid sm:grid-cols-3 gap-4" data-guide="dashboard:quick-actions">
      {ACTIONS.map((a) => {
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
