'use client'

import { useActionState } from 'react'
import { Field, Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { login, type LoginState } from '@/lib/auth-actions'

const initialState: LoginState = {}

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, initialState)

  return (
    <form action={formAction}>
      <Field label="Email lub login" htmlFor="login">
        <Input
          id="login"
          name="login"
          defaultValue="pracownik.demo"
          autoComplete="username"
          invalid={!!state.error}
        />
      </Field>
      <div className="relative">
        <a href="#" className="absolute right-0 top-0 text-xs text-accent-ink font-medium">
          Zapomniałeś hasła?
        </a>
        <Field label="Hasło" htmlFor="pw">
          <Input
            id="pw"
            name="pw"
            type="password"
            autoComplete="current-password"
            invalid={!!state.error}
          />
        </Field>
      </div>
      {state.error ? (
        <div role="alert" className="mb-3 -mt-1 text-[13px] font-medium text-error">
          {state.error}
        </div>
      ) : null}
      <Button type="submit" className="w-full mt-1" disabled={pending}>
        {pending ? 'Logowanie…' : 'Zaloguj się'}
      </Button>
    </form>
  )
}
