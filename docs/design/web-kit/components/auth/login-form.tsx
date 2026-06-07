'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { SecuredChip } from '@/components/ui/secured-chip'

/**
 * Login entry point — redirects to Keycloak OIDC.
 * No email/password handled here. Keycloak handles credentials.
 */
export function LoginForm({ callbackUrl = '/dashboard' }: { callbackUrl?: string }) {
  const [loading, setLoading] = useState(false)

  async function handleSignIn() {
    setLoading(true)
    await signIn('keycloak', { callbackUrl })
    // signIn redirects; state stays loading during redirect
  }

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-[400px]">
      <div className="text-center">
        <h1 className="font-display text-[24px] font-extrabold tracking-tightish text-navy">
          Zaloguj się
        </h1>
        <p className="mt-1.5 text-[14px] text-muted">
          Zostaniesz przekierowany do bezpiecznego logowania.
        </p>
      </div>

      <Button
        onClick={handleSignIn}
        disabled={loading}
        className="w-full h-[46px] text-[15px]"
        aria-label="Zaloguj przez Keycloak SSO"
      >
        {loading ? 'Przekierowuję…' : 'Zaloguj się przez SSO'}
      </Button>

      <SecuredChip>RODO · Krótkie sesje · Rotacja tokenów</SecuredChip>
    </div>
  )
}
