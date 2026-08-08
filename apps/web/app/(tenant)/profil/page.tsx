import Link from 'next/link'
import { AppShell } from '@/components/layout/app-shell'
import { SecuredChip } from '@/components/ui/secured-chip'
import { IconCalendar, IconFileText, IconMessageCircle, IconShieldCheck } from '@/components/icons'
import { getTenant } from '@/lib/tenant'
import { getSession } from '@/lib/session'
import type { Role } from '@/lib/nav'

// „Mój profil" — cel menu konta z topbaru (klik w avatar → „Mój profil"). Server Component: tożsamość
// pochodzi z realnej sesji Keycloak (cookie hrobot_token, dekodowany w lib/session). Pokazuje kim jest
// zalogowany użytkownik (nazwa / login / role / tenant) i daje skróty do sekcji samoobsługowych. Bez
// PESEL/danych wrażliwych — zgodnie z RODO (te dane żyją w kartotece HR, nie w widoku konta).

const ROLE_LABEL: Record<Role, string> = {
  ADMIN_KLIENTA: 'Administrator klienta',
  HR: 'HR',
  MANAGER: 'Menedżer',
  PRACOWNIK: 'Pracownik',
}

const QUICK_LINKS = [
  { href: '/grafik', icon: IconCalendar, label: 'Mój grafik', hint: 'Zmiany i dyżury' },
  { href: '/dokumenty', icon: IconFileText, label: 'Moja ewidencja', hint: 'Dokumenty i PDF' },
  { href: '/asystent', icon: IconMessageCircle, label: 'Asystent', hint: 'Polecenia głosowe/tekstowe' },
] as const

export default async function ProfilPage() {
  const session = await getSession()
  const tenant = await getTenant()
  const user = session?.user ?? { name: 'Użytkownik', role: '—', initials: '?' }
  const roles: Role[] = session?.roles ?? []
  const username = session?.username ?? ''

  return (
    <AppShell activeHref="/profil" title="Mój profil" tenant={tenant} user={user} roles={roles}>
      <div className="max-w-[880px] mx-auto">
        <h1 className="font-display font-extrabold text-3xl tracking-tighter2 text-navy leading-tight">
          Mój <span className="text-accent-ink">profil</span>
        </h1>
        <p className="text-muted text-[15px] mt-2 max-w-[52ch]">
          Twoje konto w przestrzeni {tenant.name}. Dane widoczne tylko dla Ciebie.
        </p>

        {/* Karta tożsamości */}
        <section className="mt-7 rounded-xl border border-line bg-card shadow-sm p-6">
          <div className="flex items-center gap-4">
            <span className="grid place-items-center w-[60px] h-[60px] rounded-2xl bg-gradient-to-b from-navy-700 to-navy text-white font-semibold text-xl">
              {user.initials}
            </span>
            <div className="min-w-0">
              <div className="text-xl font-semibold text-ink leading-tight">{user.name}</div>
              {username ? <div className="font-mono text-[12px] text-muted-2 mt-1">{username}</div> : null}
            </div>
            <SecuredChip className="ml-auto hidden sm:inline-flex" />
          </div>

          <dl className="mt-6 grid sm:grid-cols-2 gap-x-8 gap-y-4">
            <div>
              <dt className="font-mono text-[10.5px] tracking-[.08em] uppercase text-muted-2">Role</dt>
              <dd className="mt-1.5 flex flex-wrap gap-1.5">
                {roles.length > 0 ? (
                  roles.map((r) => (
                    <span
                      key={r}
                      className="inline-flex items-center rounded-md border border-line-strong bg-canvas px-2 py-0.5 text-[12px] font-medium text-ink"
                    >
                      {ROLE_LABEL[r]}
                    </span>
                  ))
                ) : (
                  <span className="text-[13px] text-muted">—</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10.5px] tracking-[.08em] uppercase text-muted-2">Organizacja</dt>
              <dd className="mt-1.5 text-[14px] text-ink">{tenant.name}</dd>
              <dd className="font-mono text-[11px] text-muted-2">{tenant.slug}</dd>
            </div>
          </dl>
        </section>

        {/* Skróty samoobsługowe */}
        <section className="mt-6">
          <h2 className="font-mono text-[11px] tracking-[.08em] uppercase text-muted-2 mb-3">Szybki dostęp</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            {QUICK_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="rounded-xl border border-line bg-card shadow-sm p-4 hover:border-line-strong hover:shadow transition"
              >
                <l.icon className="w-[20px] h-[20px] text-accent-ink" strokeWidth={1.7} />
                <div className="mt-2.5 text-[14px] font-semibold text-ink">{l.label}</div>
                <div className="text-[12px] text-muted-2 mt-0.5">{l.hint}</div>
              </Link>
            ))}
          </div>
        </section>

        {/* Nota RODO */}
        <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-line bg-card-2 p-4 text-[12.5px] text-muted">
          <IconShieldCheck className="w-[17px] h-[17px] text-verified shrink-0 mt-px" />
          <span>
            Dane wrażliwe (PESEL, szczegóły kadrowe) nie są prezentowane w widoku konta — przechowuje je
            zaszyfrowana kartoteka HR (AES-256-GCM), a dostęp jest audytowany. Zmianę hasła realizuje
            administrator klienta.
          </span>
        </div>
      </div>
    </AppShell>
  )
}
