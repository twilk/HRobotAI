'use client'

import { useState, type FormEvent } from 'react'
import { Modal } from '@/components/ui/modal'
import { Field, Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { UserRole } from '@/lib/users'

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

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    onInvite(email.trim(), role)
    setEmail('')
    setRole('PRACOWNIK')
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
            onChange={(e) => setEmail(e.target.value)}
            placeholder="osoba@firma.pl"
            required
            autoFocus
          />
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
