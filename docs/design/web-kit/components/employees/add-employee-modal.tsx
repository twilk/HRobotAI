'use client'

import { useState, type FormEvent } from 'react'
import { Modal } from '@/components/ui/modal'
import { Field, Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { Employee } from '@/lib/employees'

interface NewEmployeeData {
  firstName: string
  lastName: string
  email: string
  position: string
  unit: string
  contract: 'UoP' | 'Zlecenie' | 'B2B'
}

let _nextId = 100

export function AddEmployeeModal({
  open,
  onClose,
  onAdd,
}: {
  open: boolean
  onClose: () => void
  onAdd: (e: Employee) => void
}) {
  const [form, setForm] = useState<NewEmployeeData>({
    firstName: '', lastName: '', email: '', position: '', unit: '', contract: 'UoP',
  })

  function set(field: keyof NewEmployeeData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const id = String(++_nextId)
    onAdd({
      id,
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email,
      position: form.position,
      unit: form.unit,
      contract: form.contract,
      peselLast4: '0000',
      status: 'active',
    })
    setForm({ firstName: '', lastName: '', email: '', position: '', unit: '', contract: 'UoP' })
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Dodaj pracownika" className="max-w-[520px]">
      <form onSubmit={handleSubmit} noValidate>
        <div className="grid sm:grid-cols-2 gap-x-4">
          <Field label="Imię" htmlFor="add-firstName">
            <Input id="add-firstName" aria-label="Imię" value={form.firstName} onChange={(e) => set('firstName', e.target.value)} required autoFocus />
          </Field>
          <Field label="Nazwisko" htmlFor="add-lastName">
            <Input id="add-lastName" aria-label="Nazwisko" value={form.lastName} onChange={(e) => set('lastName', e.target.value)} required />
          </Field>
        </div>
        <Field label="Email" htmlFor="add-email">
          <Input id="add-email" aria-label="Email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} required />
        </Field>
        <Field label="Stanowisko" htmlFor="add-position">
          <Input id="add-position" aria-label="Stanowisko" value={form.position} onChange={(e) => set('position', e.target.value)} required />
        </Field>
        <Field label="Jednostka" htmlFor="add-unit">
          <Input id="add-unit" aria-label="Jednostka" value={form.unit} onChange={(e) => set('unit', e.target.value)} required />
        </Field>
        <Field label="Typ umowy" htmlFor="add-contract">
          <select
            id="add-contract"
            aria-label="Typ umowy"
            value={form.contract}
            onChange={(e) => set('contract', e.target.value as 'UoP' | 'Zlecenie' | 'B2B')}
            className="w-full h-11 px-[13px] rounded-sm border border-line-strong bg-card text-[14.5px] text-ink focus:outline-none focus:border-accent"
          >
            <option value="UoP">Umowa o pracę</option>
            <option value="Zlecenie">Umowa zlecenie</option>
            <option value="B2B">Kontrakt B2B</option>
          </select>
        </Field>
        <p className="font-mono text-[11px] text-muted-2 mb-4">
          PESEL jest szyfrowany automatycznie przy tworzeniu profilu w docelowym systemie.
        </p>
        <div className="flex gap-2.5 justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>Anuluj</Button>
          <Button type="submit">Zapisz pracownika</Button>
        </div>
      </form>
    </Modal>
  )
}
