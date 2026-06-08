import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
      <div className="w-full max-w-[440px] text-center">
        <p className="font-mono text-[11px] uppercase tracking-[.1em] text-muted-2 mb-3">404</p>
        <h1 className="font-display text-[26px] font-extrabold tracking-tightish text-navy">
          Nie znaleziono strony
        </h1>
        <p className="mt-2.5 text-[14.5px] text-muted max-w-[38ch] mx-auto leading-relaxed">
          Ta strona nie istnieje lub została przeniesiona.
        </p>
        <div className="mt-7">
          <Link
            href="/dashboard"
            className="inline-flex h-[42px] items-center justify-center rounded-sm bg-navy px-6 text-[14.5px] font-semibold text-white hover:bg-navy/90"
          >
            Wróć do pulpitu
          </Link>
        </div>
      </div>
    </div>
  )
}
