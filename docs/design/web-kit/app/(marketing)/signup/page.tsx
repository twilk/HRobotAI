import type { Metadata } from 'next'
import { BrandMark, Wordmark } from '@/components/ui/brand-mark'
import { SignupForm } from '@/components/auth/signup-form'

export const metadata: Metadata = {
  title: 'Utwórz konto · HRobot',
  description: 'Załóż przestrzeń roboczą HRobot. Bezpłatne 14 dni, bez karty, zgodnie z RODO.',
}

// Server Component — static shell; only the form hydrates.
export default function SignupPage() {
  return (
    <div className="motif-navy min-h-screen flex items-center justify-center bg-navy p-4">
      <div className="w-full max-w-[432px] relative">
        <div className="bg-card border border-line rounded-lg shadow-lift p-7">
          <div className="flex flex-col items-center text-center mb-5">
            <div className="flex items-center gap-2.5 mb-4">
              <BrandMark />
              <Wordmark tone="light" />
            </div>
            <h1 className="font-display font-extrabold text-[23px] tracking-tightish text-navy">Utwórz konto</h1>
            <p className="text-muted text-[13.5px] mt-1.5">Bezpłatne 14 dni. Bez karty kredytowej.</p>
          </div>

          <SignupForm />

          <div className="mt-[18px] text-center text-[13px] text-muted">
            Masz już konto?{' '}
            <a href="/login" className="text-accent-ink font-medium">
              Zaloguj się
            </a>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 mt-[18px] font-mono text-[10.5px] text-white/55">
          <b className="text-accent-navy font-medium">RODO</b> · Dane w UE · Szyfrowanie AES-256
        </div>
      </div>
    </div>
  )
}
