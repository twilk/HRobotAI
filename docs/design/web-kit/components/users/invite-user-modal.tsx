'use client'

import { useState, type FormEvent } from 'react'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { Modal } from '@/components/ui/modal'
import { Field, Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { UserRole } from '@/lib/users'

const inviteSchema = z.object({
  email: z.string().min(1, 'Email jest wymagany').email('Podaj poprawny adres email'),
  role: z.enum(['PRACOWNIK', 'MANAGER', 'HR']),
})
type InviteErrors = Partial<Record<keyof z.infer<typeof inviteSchema>, string>>

const INVITABLE_ROLES: { value: UserRole; label: string }[] = [
  { value: 'PRACOWNIK', label: 'Pracownik' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'HR', label: 'HR' },
]

export function InviteUserModal({
  open,
  onClose,
  onInvite,
}: {
  open: boolean
  onClose: () => void
  onInvite: (email: string, role: UserRole) => void
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<UserRole>('PRACOWNIK')
  const [errors, setErrors] = useState<InviteErrors>({})

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const result = inviteSchema.safeParse({ email: email.trim(), role })
    if (!result.success) {
      const fieldErrors: InviteErrors = {}
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof InviteErrors
        if (!fieldErrors[key]) fieldErrors[key] = issue.message
      }
      setErrors(fieldErrors)
      return
    }
    onInvite(result.data.email, result.data.role)
    toast.success(`Zaproszenie wysłane do ${result.data.email}`)
    setEmail('')
    setRole('PRACOWNIK')
    setErrors({})
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Zaproś użytkownika">
      <form onSubmit={handleSubmit} noValidate>
        <Field label="Email" htmlFor="invite-email">
          <Input
            id="invite-email"
            aria-label="Email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }))
            }}
            placeholder="osoba@firma.pl"
            required
            autoFocus
          />
          {errors.email && (
            <p role="alert" className="mt-1 text-[12px] text-red-500">{errors.email}</p>
          )}
        </Field>
        <Field label="Rola" htmlFor="invite-role">
          <select
            id="invite-role"
            aria-label="Rola"
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            className="w-full h-11 px-[13px] rounded-sm border border-line-strong bg-card text-[14.5px] text-ink focus:outline-none focus:border-accent"
          >
            {INVITABLE_ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </Field>
        <p className="font-mono text-[11px] text-muted-2 mb-4">
          Zaproszenie RBAC — Admin klienta nadaje role w ramach własnej przestrzeni.
        </p>
        <div className="flex gap-2.5 justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>Anuluj</Button>
          <Button type="submit">Wyślij zaproszenie</Button>
        </div>
      </form>
    </Modal>
  )
}
