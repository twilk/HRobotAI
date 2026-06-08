'use client'

import { useState, type FormEvent } from 'react'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { Modal } from '@/components/ui/modal'
import { Field, Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { Employee } from '@/lib/employees'
import { onboardNewEmployee } from '@/lib/actions/onboarding-actions'

const employeeSchema = z.object({
  firstName: z.string().min(1, 'Imię jest wymagane').max(100),
  lastName: z.string().min(1, 'Nazwisko jest wymagane').max(100),
  email: z.string().min(1, 'Email jest wymagany').email('Podaj poprawny adres email'),
  position: z.string().min(1, 'Stanowisko jest wymagane').max(200),
  unit: z.string().min(1, 'Jednostka jest wymagana').max(200),
  contract: z.enum(['UoP', 'Zlecenie', 'B2B']),
})
type FormErrors = Partial<Record<keyof z.infer<typeof employeeSchema>, string>>

interface NewEmployeeData {
  firstName: string
  lastName: string
  email: string
  position: string
  unit: string
  contract: 'UoP' | 'Zlecenie' | 'B2B'
}

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
  const [errors, setErrors] = useState<FormErrors>({})

  function set(field: keyof NewEmployeeData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const result = employeeSchema.safeParse(form)
    if (!result.success) {
      const fe: FormErrors = {}
      result.error.issues.forEach(i => {
        if (!fe[i.path[0] as keyof FormErrors]) {
          fe[i.path[0] as keyof FormErrors] = i.message
        }
      })
      setErrors(fe)
      return
    }

    const onboardResult = await onboardNewEmployee({
      name: `${result.data.firstName} ${result.data.lastName}`,
      department: result.data.unit,
      position: result.data.position,
      email: result.data.email,
    })

    if (!onboardResult.success) {
      toast.error(onboardResult.error ?? 'Błąd tworzenia pracownika')
      return
    }

    const id = onboardResult.employeeId ?? crypto.randomUUID()
    onAdd({ id, ...result.data, peselLast4: '0000', status: 'active' })
    setErrors({})
    setForm({ firstName: '', lastName: '', email: '', position: '', unit: '', contract: 'UoP' })
    onClose()
    toast.success('Pracownik dodany')
  }

  return (
    <Modal open={open} onClose={onClose} title="Dodaj pracownika" className="max-w-[520px]">
      <form onSubmit={handleSubmit} noValidate>
        <div className="grid sm:grid-cols-2 gap-x-4">
          <Field label="Imię" htmlFor="add-firstName">
            <Input id="add-firstName" aria-label="Imię" value={form.firstName} onChange={(e) => set('firstName', e.target.value)} autoFocus />
            {errors.firstName && <p className="mt-1 text-xs text-red-600">{errors.firstName}</p>}
          </Field>
          <Field label="Nazwisko" htmlFor="add-lastName">
            <Input id="add-lastName" aria-label="Nazwisko" value={form.lastName} onChange={(e) => set('lastName', e.target.value)} />
            {errors.lastName && <p className="mt-1 text-xs text-red-600">{errors.lastName}</p>}
          </Field>
        </div>
        <Field label="Email" htmlFor="add-email">
          <Input id="add-email" aria-label="Email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email}</p>}
        </Field>
        <Field label="Stanowisko" htmlFor="add-position">
          <Input id="add-position" aria-label="Stanowisko" value={form.position} onChange={(e) => set('position', e.target.value)} />
          {errors.position && <p className="mt-1 text-xs text-red-600">{errors.position}</p>}
        </Field>
        <Field label="Jednostka" htmlFor="add-unit">
          <Input id="add-unit" aria-label="Jednostka" value={form.unit} onChange={(e) => set('unit', e.target.value)} />
          {errors.unit && <p className="mt-1 text-xs text-red-600">{errors.unit}</p>}
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
          {errors.contract && <p className="mt-1 text-xs text-red-600">{errors.contract}</p>}
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
