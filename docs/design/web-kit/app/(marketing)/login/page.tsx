import { BrandMark, Wordmark } from '@/components/ui/brand-mark'
import { LoginForm } from '@/components/auth/login-form'

export default function LoginPage() {
  return (
    <div className="motif-navy min-h-screen flex items-center justify-center bg-navy p-4">
      <div className="w-full max-w-[420px] relative">
        <div className="bg-card border border-line rounded-lg shadow-lift p-7">
          <div className="flex flex-col items-center text-center mb-5">
            <div className="flex items-center gap-2.5 mb-4">
              <BrandMark />
              <Wordmark tone="light" />
            </div>
            <h1 className="font-display font-extrabold text-[23px] tracking-tightish text-navy">Zaloguj się</h1>
            <p className="text-muted text-[13.5px] mt-1.5">
              Witaj ponownie w przestrzeni <b className="text-accent-ink">ACME</b>
            </p>
          </div>

          <LoginForm />

          <div className="mt-[18px] pt-4 border-t border-line flex items-center justify-center font-mono text-[10.5px] text-muted-2">
            Zabezpieczone · realm: hrobot-acme
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 mt-[18px] font-mono text-[10.5px] text-white/55">
          <b className="text-accent-navy font-medium">RODO</b> · Krótkie sesje · Rotacja tokenów
        </div>
      </div>
    </div>
  )
}
