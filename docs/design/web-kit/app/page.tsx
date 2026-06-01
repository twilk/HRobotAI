import Link from 'next/link'
import { BrandMark, Wordmark } from '@/components/ui/brand-mark'
import { IconArrowRight } from '@/components/icons'

// Dev index — links every screen for click-through. Production redirects / → /signup.
const SCREENS: { href: string; title: string; note: string }[] = [
  { href: '/dashboard', title: 'Dashboard', note: 'Powitanie, szybkie akcje, ochrona danych' },
  { href: '/pracownicy', title: 'Pracownicy', note: 'Tabela danych, PESEL mono, statusy' },
  { href: '/grafik', title: 'Grafik', note: 'Stub modułu' },
  { href: '/wnioski', title: 'Wnioski', note: 'Stub modułu' },
  { href: '/dostepy', title: 'Dostępy', note: 'Stub modułu' },
  { href: '/ustawienia', title: 'Ustawienia', note: 'Stub modułu' },
  { href: '/ustawienia/uzytkownicy', title: 'Użytkownicy', note: 'Stub modułu (ADMIN)' },
  { href: '/signup', title: 'Rejestracja', note: 'Slug na żywo, siła hasła' },
  { href: '/login', title: 'Logowanie', note: 'Motyw HRobot' },
]

export default function HomePage() {
  // Stamp a start time slightly in the past so provisioning shows progress.
  const job = `job-${Date.now() - 6000}`
  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-[840px] mx-auto px-6 py-14">
        <div className="flex items-center gap-3 mb-2">
          <BrandMark size={44} />
          <Wordmark tone="light" className="text-[26px]" />
        </div>
        <h1 className="font-display font-extrabold text-3xl tracking-tighter2 text-navy mt-3">System projektowy — podgląd</h1>
        <p className="text-muted text-[15px] mt-2 max-w-[60ch]">
          Wszystkie ekrany HRobot, w pełni działające. Refit pod tożsamość RODO-native, EU-trust. Bez glassmorphizmu, bez
          Inter, bez neonu.
        </p>

        <div className="grid sm:grid-cols-2 gap-3 mt-8">
          {SCREENS.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="group flex items-center gap-3 bg-card border border-line rounded-lg shadow-sm p-4 transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-0.5 hover:shadow hover:border-line-strong"
            >
              <div>
                <div className="font-semibold text-[15px] tracking-tightish">{s.title}</div>
                <div className="text-[12.5px] text-muted">{s.note}</div>
              </div>
              <IconArrowRight className="ml-auto w-[18px] h-[18px] text-muted-2 group-hover:text-accent-ink" strokeWidth={2} />
            </Link>
          ))}
          <Link
            href={`/signup/status?job=${job}`}
            className="group flex items-center gap-3 bg-card border border-line rounded-lg shadow-sm p-4 transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-0.5 hover:shadow hover:border-line-strong"
          >
            <div>
              <div className="font-semibold text-[15px] tracking-tightish">Provisioning</div>
              <div className="text-[12.5px] text-muted">Pipeline na żywo → dashboard</div>
            </div>
            <IconArrowRight className="ml-auto w-[18px] h-[18px] text-muted-2 group-hover:text-accent-ink" strokeWidth={2} />
          </Link>
        </div>
      </div>
    </div>
  )
}
