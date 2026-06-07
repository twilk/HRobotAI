'use client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="pl">
      <body className="min-h-screen bg-canvas flex items-center justify-center p-4">
        <div className="w-full max-w-[440px] rounded-lg border border-line bg-white p-7 text-center shadow-sm">
          <h1 className="font-display text-[21px] font-bold text-navy">Błąd krytyczny</h1>
          <p className="mt-2.5 text-[14.5px] text-muted max-w-[40ch] mx-auto leading-relaxed">
            Aplikacja napotkała nieoczekiwany błąd. Napisz na{' '}
            <span className="font-medium text-ink">pomoc@hrobot.ai</span>.
          </p>
          {error.digest && (
            <p className="mt-2 font-mono text-[10.5px] text-muted-2">ref: {error.digest}</p>
          )}
          <button
            onClick={reset}
            className="mt-6 inline-flex h-[42px] items-center justify-center rounded-sm bg-navy px-6 text-[14.5px] font-semibold text-white hover:bg-navy/90"
          >
            Spróbuj ponownie
          </button>
        </div>
      </body>
    </html>
  )
}
