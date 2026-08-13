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
      {/* Link „Zapomniałeś hasła?" usunięty — nie ma flow resetu (był martwym href="#").
          Reset hasła realizuje admin klienta / Keycloak; wróci jako realna trasa, gdy powstanie. */}
      <Field label="Hasło" htmlFor="pw">
        <Input
          id="pw"
          name="pw"
          type="password"
          autoComplete="current-password"
          invalid={!!state.error}
        />
      </Field>
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
