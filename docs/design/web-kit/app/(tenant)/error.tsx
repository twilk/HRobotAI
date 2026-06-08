'use client'

import { Button } from '@/components/ui/button'

/** Tenant-area error boundary. Centered, calm, no teal — per screens-and-components.md §D. */
export default function TenantError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="grid min-h-screen place-items-center bg-canvas px-4">
      <div className="w-full max-w-[440px] rounded-lg border border-line bg-card p-7 text-center shadow-sm">
        <h1 className="font-display text-[21px] font-bold tracking-tightish text-navy">Coś poszło nie tak</h1>
        <p className="mx-auto mt-2.5 max-w-[40ch] text-[14.5px] leading-relaxed text-muted">
          Nie udało się wczytać tego widoku. Spróbuj ponownie — jeśli problem się powtarza, napisz na{' '}
          <span className="font-medium text-ink">pomoc@hrobot.ai</span>.
        </p>
        {error.digest ? <p className="mt-2 font-mono text-[10.5px] text-muted-2">ref: {error.digest}</p> : null}
        <div className="mt-[22px] flex justify-center">
          <Button onClick={reset}>Spróbuj ponownie</Button>
        </div>
      </div>
    </div>
  )
}
