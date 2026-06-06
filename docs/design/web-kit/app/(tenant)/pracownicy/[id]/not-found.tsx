import Link from 'next/link'
import { AppShell } from '@/components/layout/app-shell'
import { IconUsers, IconChevronLeft } from '@/components/icons'
import type { Role } from '@/lib/nav'

export default function PracownikNotFound() {
  const tenant = { name: 'ACME Sp. z o.o.', slug: 'acme.hrobot.ai' }
  const user = { name: 'Jan Kowalski', role: 'Admin klienta', initials: 'JK' }
  const roles: Role[] = ['ADMIN_KLIENTA']

  return (
    <AppShell activeHref="/pracownicy" title="Pracownicy" tenant={tenant} user={user} roles={roles}>
      <div className="mx-auto mt-[6vh] max-w-[440px] text-center">
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl border border-line bg-card shadow-sm">
          <IconUsers className="h-[30px] w-[30px] text-accent-ink" strokeWidth={1.5} />
        </div>
        <h1 className="font-display text-[21px] font-bold tracking-tightish text-navy">Nie znaleziono pracownika</h1>
        <p className="mx-auto mt-2.5 max-w-[38ch] text-[14.5px] leading-relaxed text-muted">
          Ten pracownik nie istnieje lub nie masz do niego dostępu w tej organizacji.
        </p>
        <div className="mt-[22px] flex justify-center">
          <Link
            href="/pracownicy"
            className="inline-flex h-[42px] items-center justify-center gap-2 rounded-sm border border-line-strong bg-transparent px-[18px] text-[14.5px] font-semibold text-ink hover:bg-card-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <IconChevronLeft className="h-[17px] w-[17px]" strokeWidth={1.8} />
            Wróć do listy pracowników
          </Link>
        </div>
      </div>
    </AppShell>
  )
}
