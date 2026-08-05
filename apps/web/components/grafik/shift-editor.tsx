'use client'

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { IconClose } from '@/components/icons'
import { IconTrash } from './grafik-icons'
import type { CreateShiftInput, Employee, Shift } from '@/lib/grafik'

/** A location option for the editor — id + a short human label (we have no location-name API). */
export interface LocationOption {
  id: string
  label: string
}

export interface ShiftEditorProps {
  /** Present → edit mode (shows Delete); absent → create mode. */
  shift: Shift | null
  /** Defaults for a fresh shift (employee row + day the empty cell was clicked). */
  defaults: { employeeId: string; date: string }
  employees: Employee[]
  locations: LocationOption[]
  busy: boolean
  error: string | null
  onSubmit: (input: CreateShiftInput) => void
  onDelete: () => void
  onClose: () => void
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export function ShiftEditor({
  shift,
  defaults,
  employees,
  locations,
  busy,
  error,
  onSubmit,
  onDelete,
  onClose,
}: ShiftEditorProps) {
  const editing = shift !== null
  const [employeeId, setEmployeeId] = useState(shift?.employeeId ?? defaults.employeeId)
  const [date, setDate] = useState(shift?.date.slice(0, 10) ?? defaults.date)
  const [lokalizacjaId, setLokalizacjaId] = useState(shift?.lokalizacjaId ?? locations[0]?.id ?? '')
  const [start, setStart] = useState(shift?.start ?? '08:00')
  const [end, setEnd] = useState(shift?.end ?? '16:00')
  const [role, setRole] = useState(shift?.role ?? '')
  const [localError, setLocalError] = useState<string | null>(null)

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!employeeId) return setLocalError('Wybierz pracownika')
    if (!lokalizacjaId) return setLocalError('Podaj lokalizację')
    if (!TIME.test(start) || !TIME.test(end)) return setLocalError('Godziny w formacie HH:mm')
    if (start >= end) return setLocalError('Koniec zmiany musi być po jej początku')
    if (!role.trim()) return setLocalError('Podaj rolę / stanowisko')
    setLocalError(null)
    onSubmit({ employeeId, lokalizacjaId, date, start, end, role: role.trim(), source: 'MANUAL' })
  }

  const shown = localError ?? error

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-navy/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-label={editing ? 'Edytuj zmianę' : 'Dodaj zmianę'}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-[440px] bg-card border border-line rounded-lg shadow-sm">
        <div className="flex items-center justify-between px-5 py-[15px] border-b border-line">
          <h2 className="font-display font-bold text-[17px] text-navy">
            {editing ? 'Edytuj zmianę' : 'Dodaj zmianę'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij"
            className="grid place-items-center w-8 h-8 rounded-sm text-muted hover:bg-card-2"
          >
            <IconClose className="w-[18px] h-[18px]" strokeWidth={1.7} />
          </button>
        </div>

        <form onSubmit={submit} className="px-5 py-5">
          <Field label="Pracownik" htmlFor="se-emp">
            <select
              id="se-emp"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              disabled={editing}
              className="w-full h-11 px-[13px] rounded-sm border border-line-strong bg-card text-[14.5px] text-ink focus:outline-none focus:border-accent disabled:opacity-60"
            >
              <option value="">— wybierz —</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.firstName} {e.lastName}
                  {e.position ? ` · ${e.position}` : ''}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Data" htmlFor="se-date">
              <Input id="se-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Lokalizacja" htmlFor="se-loc">
              {locations.length > 0 ? (
                <select
                  id="se-loc"
                  value={lokalizacjaId}
                  onChange={(e) => setLokalizacjaId(e.target.value)}
                  className="w-full h-11 px-[13px] rounded-sm border border-line-strong bg-card text-[14.5px] text-ink focus:outline-none focus:border-accent"
                >
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id="se-loc"
                  placeholder="UUID lokalizacji"
                  value={lokalizacjaId}
                  onChange={(e) => setLokalizacjaId(e.target.value)}
                />
              )}
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Początek" htmlFor="se-start">
              <Input id="se-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="Koniec" htmlFor="se-end">
              <Input id="se-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </div>

          <Field label="Rola / stanowisko" htmlFor="se-role">
            <Input
              id="se-role"
              placeholder="np. Operator maszyn"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            />
          </Field>

          {shown ? (
            <p className="text-[13px] text-error mb-3" role="alert">
              {shown}
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-2 mt-1">
            {editing ? (
              <Button
                type="button"
                variant="ghost"
                onClick={onDelete}
                disabled={busy}
                className="h-[42px] px-3.5 text-error border-error/40 hover:bg-error/[0.06]"
              >
                <IconTrash className="w-[17px] h-[17px]" strokeWidth={1.7} />
                Usuń
              </Button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2.5">
              <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
                Anuluj
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Zapisywanie…' : editing ? 'Zapisz' : 'Dodaj'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
