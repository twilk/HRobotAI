'use client'

import { useRouter } from 'next/navigation'
import type { FormEvent } from 'react'
import { Field, Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function LoginForm() {
  const router = useRouter()

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    router.push('/dashboard')
  }

  return (
    <form onSubmit={onSubmit}>
      <Field label="Email lub login" htmlFor="login">
        <Input id="login" name="login" defaultValue="jan.kowalski@acme.pl" autoComplete="username" />
      </Field>
      <div className="relative">
        <a href="#" className="absolute right-0 top-0 text-xs text-accent-ink font-medium">
          Zapomniałeś hasła?
        </a>
        <Field label="Hasło" htmlFor="pw">
          <Input id="pw" name="pw" type="password" defaultValue="bardzo-tajne-haslo" autoComplete="current-password" />
        </Field>
      </div>
      <Button type="submit" className="w-full mt-1">
        Zaloguj się
      </Button>
    </form>
  )
}
