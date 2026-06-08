'use client'

import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Field, Input } from '@/components/ui/input'
import { EmployeesTable } from './employees-table'
import { EmployeesEmpty } from './employees-empty'
import { AddEmployeeModal } from './add-employee-modal'
import { IconPlus, IconSearch, IconEdit } from '@/components/icons'
import type { Employee, EmployeeDetail, EmployeeStatus } from '@/lib/employees'
import { editEmployee, changeEmployeeStatus } from '@/lib/actions/employees-actions'

// ---------------------------------------------------------------------------
// EditEmployeeModal
// ---------------------------------------------------------------------------

type EditFormData = {
  firstName: string
  lastName: string
  position: string
  unit: string
  email: string
  phone: string
  status: 'active' | 'inactive' | 'on-leave' | 'suspended'
}

const STATUS_OPTIONS: { value: EditFormData['status']; label: string }[] = [
  { value: 'active', label: 'Aktywny' },
  { value: 'inactive', label: 'Nieaktywny' },
  { value: 'on-leave', label: 'Na urlopie' },
  { value: 'suspended', label: 'Zawieszony' },
]

function toEditStatus(status: EmployeeStatus): EditFormData['status'] {
  if (status === 'leave') return 'on-leave'
  return (status as EditFormData['status']) ?? 'active'
}

interface EditEmployeeModalProps {
  employee: Employee | null
  open: boolean
  onClose: () => void
  onSaved: (id: string, updates: Partial<Employee>) => void
}

function EditEmployeeModal({ employee, open, onClose, onSaved }: EditEmployeeModalProps) {
  const [form, setForm] = useState<EditFormData>(() => ({
    firstName: employee?.firstName ?? '',
    lastName: employee?.lastName ?? '',
    position: employee?.position ?? '',
    unit: employee?.unit ?? '',
    email: employee?.email ?? '',
    phone: (employee as EmployeeDetail | null)?.phone ?? '',
    status: toEditStatus(employee?.status ?? 'active'),
  }))

  // Sync form when employee changes (opening for different row)
  if (
    employee &&
    (form.firstName !== employee.firstName || form.lastName !== employee.lastName)
  ) {
    setForm({
      firstName: employee.firstName,
      lastName: employee.lastName,
      position: employee.position,
      unit: employee.unit,
      email: employee.email,
      phone: (employee as EmployeeDetail).phone ?? '',
      status: toEditStatus(employee.status),
    })
  }

  function set<K extends keyof EditFormData>(field: K, value: EditFormData[K]) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!employee) return

    const profileUpdates = {
      firstName: form.firstName,
      lastName: form.lastName,
      position: form.position,
      unit: form.unit,
      email: form.email,
      phone: form.phone,
    }

    const [editResult, statusResult] = await Promise.all([
      editEmployee(employee.id, profileUpdates),
      changeEmployeeStatus(employee.id, form.status, 'admin'),
    ])

    if (!editResult.success || !statusResult.success) {
      toast.error(editResult.error ?? statusResult.error ?? 'Błąd zapisu')
      return
    }

    onSaved(employee.id, { ...profileUpdates, status: form.status })
    toast.success('Zmiany zapisane')
    onClose()
  }

  if (!employee) return null

  return (
    <Modal open={open} onClose={onClose} title="Edytuj pracownika" className="max-w-[520px]">
      <form onSubmit={handleSubmit} noValidate>
        <div className="grid sm:grid-cols-2 gap-x-4">
          <Field label="Imię" htmlFor="edit-firstName">
            <Input id="edit-firstName" aria-label="Imię" value={form.firstName} onChange={(e) => set('firstName', e.target.value)} autoFocus />
          </Field>
          <Field label="Nazwisko" htmlFor="edit-lastName">
            <Input id="edit-lastName" aria-label="Nazwisko" value={form.lastName} onChange={(e) => set('lastName', e.target.value)} />
          </Field>
        </div>
        <Field label="Stanowisko" htmlFor="edit-position">
          <Input id="edit-position" aria-label="Stanowisko" value={form.position} onChange={(e) => set('position', e.target.value)} />
        </Field>
        <Field label="Jednostka" htmlFor="edit-unit">
          <Input id="edit-unit" aria-label="Jednostka" value={form.unit} onChange={(e) => set('unit', e.target.value)} />
        </Field>
        <Field label="Email" htmlFor="edit-email">
          <Input id="edit-email" aria-label="Email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Telefon" htmlFor="edit-phone">
          <Input id="edit-phone" aria-label="Telefon" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Status" htmlFor="edit-status">
          <select
            id="edit-status"
            aria-label="Status"
            value={form.status}
            onChange={(e) => set('status', e.target.value as EditFormData['status'])}
            className="w-full h-11 px-[13px] rounded-sm border border-line-strong bg-card text-[14.5px] text-ink focus:outline-none focus:border-accent"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Field>
        <div className="flex gap-2.5 justify-end mt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Anuluj</Button>
          <Button type="submit">Zapisz zmiany</Button>
        </div>
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// PracownicyClientView
// ---------------------------------------------------------------------------

function matchesQuery(e: Employee, q: string): boolean {
  const s = q.toLowerCase()
  return (
    e.firstName.toLowerCase().includes(s) ||
    e.lastName.toLowerCase().includes(s) ||
    e.email.toLowerCase().includes(s) ||
    e.position.toLowerCase().includes(s)
  )
}

export function PracownicyClientView({ initialEmployees }: { initialEmployees: Employee[] }) {
  const [employees, setEmployees] = useState<Employee[]>(initialEmployees)
  const [query, setQuery] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editTarget, setEditTarget] = useState<Employee | null>(null)

  const filtered = query ? employees.filter((e) => matchesQuery(e, query)) : employees

  function handleAdd(emp: Employee) {
    setEmployees((prev) => [
      ...prev,
      {
        ...emp,
        phone: '',
        address: '',
        birthYear: '',
        hireDate: new Date().toISOString().slice(0, 10),
        contractType: emp.contract === 'UoP' ? 'Czas nieokreślony' : emp.contract === 'Zlecenie' ? 'Umowa zlecenie' : 'Kontrakt B2B',
        fte: 'Pełny etat · 1,0',
        manager: '',
        salaryMasked: '•• ••• PLN',
        region: 'EU-CENTRAL',
        realm: 'hrobot-acme',
        audit: [{ ts: new Date().toISOString().slice(0, 16).replace('T', ' '), action: 'Utworzono profil', actor: 'Admin' }],
      } as EmployeeDetail,
    ])
  }

  function handleSaved(id: string, updates: Partial<Employee>) {
    setEmployees((prev) => prev.map((e) => (e.id === id ? { ...e, ...updates } : e)))
  }

  if (employees.length === 0 && !query) {
    return (
      <>
        <EmployeesEmpty />
        <AddEmployeeModal open={showAdd} onClose={() => setShowAdd(false)} onAdd={handleAdd} />
      </>
    )
  }

  return (
    <div className="max-w-[1120px] mx-auto">
      <div className="flex items-end justify-between gap-4 mb-[22px]">
        <div>
          <h1 className="font-display font-extrabold text-[26px] tracking-tightish text-navy leading-tight">Pracownicy</h1>
          <p className="text-muted text-sm mt-1.5 whitespace-nowrap">
            {filtered.length !== employees.length
              ? `${filtered.length} z ${employees.length} osób`
              : `${employees.length} osób · 2 jednostki organizacyjne`}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="relative hidden sm:block" data-guide="pracownicy:search">
            <IconSearch className="absolute left-[11px] top-[11px] w-[17px] h-[17px] text-muted-2" strokeWidth={1.7} />
            <label htmlFor="emp-search" className="sr-only">Szukaj pracownika</label>
            <input
              id="emp-search"
              role="searchbox"
              placeholder="Szukaj pracownika"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-10 w-[230px] pl-[35px] pr-3 rounded-sm border border-line-strong bg-card text-sm text-ink focus:outline-none focus:border-accent"
            />
          </div>
          <Button className="h-10 px-3.5 text-sm" onClick={() => setShowAdd(true)} data-guide="pracownicy:add-employee">
            <IconPlus className="w-[17px] h-[17px]" strokeWidth={2} />
            Dodaj pracownika
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="py-16 text-center text-muted">
          <p className="font-medium">Brak wyników dla &bdquo;{query}&rdquo;</p>
          <button onClick={() => setQuery('')} className="mt-2 text-sm text-accent-ink hover:underline">Wyczyść filtr</button>
        </div>
      ) : (
        <EmployeesTable employees={filtered} onEdit={(e) => setEditTarget(e)} />
      )}

      <AddEmployeeModal open={showAdd} onClose={() => setShowAdd(false)} onAdd={handleAdd} />

      <EditEmployeeModal
        employee={editTarget}
        open={editTarget !== null}
        onClose={() => setEditTarget(null)}
        onSaved={handleSaved}
      />
    </div>
  )
}
