import Link from 'next/link'
import { AppShell } from '@/components/layout/app-shell'
import { Card } from '@/components/ui/card'
import { IconBuilding, IconUser, IconArrowRight } from '@/components/icons'
import { requirePageSession } from '@/lib/session'

const SECTIONS = [
  {
    href: '/ustawienia/placowki',
    icon: IconBuilding,
    title: 'Placówki',
    desc: 'Lokalizacje, adresy oraz dni i godziny pracy. Te ustawienia sterują grafikiem.',
    dataGuide: 'ustawienia:nav-placowki',
  },
  {
    href: '/ustawienia/uzytkownicy',
    icon: IconUser,
    title: 'Użytkownicy',
    desc: 'Zapraszaj HR i menedżerów. Zarządzaj rolami RBAC (Pracownik, Manager, HR, Admin).',
    dataGuide: 'ustawienia:nav-uzytkownicy',
  },
]

export default async function UstawieniaPage() {
  const { user, tenant, roles } = await requirePageSession()
  return (
    <AppShell activeHref="/ustawienia" title="Ustawienia" tenant={tenant} user={user} roles={roles}>
      <div className="mx-auto max-w-[1120px]">
        <div className="mb-[22px]">
          <h1 className="font-display text-[26px] font-extrabold leading-tight tracking-tightish text-navy">
            Ustawienia
          </h1>
          <p className="mt-1.5 text-sm text-muted">Konfiguracja przestrzeni roboczej ACME.</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          {SECTIONS.map((s) => {
            const Icon = s.icon
            return (
              <Link key={s.href} href={s.href} data-guide={s.dataGuide} className="group">
                <Card className="h-full p-[18px] flex flex-col gap-3 transition-[transform,box-shadow,border-color] duration-150 group-hover:-translate-y-0.5 group-hover:shadow group-hover:border-line-strong">
                  <span className="grid place-items-center w-10 h-10 rounded-[10px] border border-line bg-card-2">
                    <Icon className="w-5 h-5 text-accent-ink" />
                  </span>
                  <h3 className="text-[15.5px] font-semibold tracking-tightish">{s.title}</h3>
                  <p className="text-[13px] text-muted leading-snug flex-1">{s.desc}</p>
                  <span className="mt-0.5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent-ink">
                    Przejdź
                    <IconArrowRight className="w-[15px] h-[15px] transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
                  </span>
                </Card>
              </Link>
            )
          })}
        </div>
      </div>
    </AppShell>
  )
}
