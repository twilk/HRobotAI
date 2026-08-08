'use client'

import { useState, type FormEvent } from 'react'
import { Field, Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { SlugInput } from './slug-input'
import { PasswordField } from './password-strength'

export function SignupForm() {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const payload = Object.fromEntries(new FormData(e.currentTarget))
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.status === 202) {
        const { jobId } = (await res.json()) as { jobId: string }
        // Carry the chosen slug so the status page can name THIS tenant's address. Without it that
        // page fell back to a hardcoded address and told every new customer their workspace was
        // being created at the pilot customer's domain. See lib/tenant.ts for the same class of bug
        // on the authenticated side.
        const slug = typeof payload.slug_normalized === 'string' ? payload.slug_normalized : ''
        const q = new URLSearchParams({ job: jobId, ...(slug ? { slug } : {}) })
        window.location.assign(`/signup/status?${q}`)
        return
      }
      if (res.status === 409) {
        setError('Ta nazwa jest już zajęta. Wybierz inny adres.')
        return
      }
      setError('Coś poszło nie tak. Spróbuj ponownie.')
    } catch {
      setError('Brak połączenia. Sprawdź internet i spróbuj ponownie.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      {error ? (
        <div role="alert" className="mb-4 rounded-sm border border-error/30 bg-error/[0.06] px-3 py-2.5 text-[13px] text-error">
          {error}
        </div>
      ) : null}

      <Field label="Nazwa firmy" htmlFor="company">
        <Input id="company" name="company" autoComplete="organization" required />
      </Field>

      <SlugInput />

      <Field label="Email administratora" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>

      <PasswordField />

      <Button type="submit" className="w-full mt-1" disabled={submitting}>
        {submitting ? 'Tworzenie konta…' : 'Utwórz konto'}
      </Button>
    </form>
  )
}
