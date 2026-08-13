'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import { contractLabel } from '@/components/employees/employees-screen'
import { DEMO_UNIT_NAMES } from '@/lib/demo-locations'
import {
  buildEmployeeCreate,
  EMPLOYMENT_TYPES,
  employeeSelectClass,
  mutationErrorMessage,
  type EmployeeCreateFormState,
  type EmployeeProfileData,
} from '@/lib/employee-profile'

/** Same unit source as the edit form — Unit has no list endpoint yet, so DEMO_UNIT_NAMES is the only
 *  real map of unit ids in web-kit. Unlike the edit form there is no "current" unit to fall back to
 *  here (a brand-new employee has none yet), so a blank "wybierz jednostkę" placeholder leads the
 *  list instead. */
const UNIT_OPTIONS = Object.entries(DEMO_UNIT_NAMES).map(([id, label]) => ({ id, label }))

/** Today's date as a `type="date"` input value ("2026-07-13") — a sensible default hiredAt for a
 *  newly-added employee; HR can still change it. */
function todayIso(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

function emptyForm(): EmployeeCreateFormState {
  return {
    firstName: '',
    lastName: '',
    position: '',
    employmentType: 'UMOWA_O_PRACE',
    unitId: '',
    hiredAt: todayIso(),
    etat: '',
    qualifications: '',
    pesel: '',
  }
}

export interface EmployeeAddDialogProps {
  onCancel: () => void
  /** Called with the created SAFE_SELECT employee returned by `POST /api/employees` (201) — no pesel
   *  is ever present on this object. The caller re-fetches the roster for correctness rather than
   *  relying solely on this value, but it's passed through in case a caller wants it. */
  onCreated: (created: EmployeeProfileData) => void
}

/**
 * HR/ADMIN_KLIENTA-only "Dodaj pracownika" create form (Task 4b). Rendered by employees-screen.tsx
 * as an inline panel above the roster table when canManage and the user clicked "Dodaj pracownika" —
 * there is no Dialog/Modal primitive in components/ui/ yet (only shift-editor.tsx has an unrelated
 * "Modal" mention), so this mirrors employee-profile.tsx's in-place expand pattern instead of
 * introducing a new dependency. Field/validation/guard patterns are copied from
 * employee-edit-form.tsx (Task 3b) — nothing new invented here, just CREATE instead of PATCH:
 * every field starts blank (this is a new employee, there's nothing to seed from), and pesel is
 * REQUIRED (the backend's CreateEmployeeDto requires it), not write-only-optional.
 */
export function EmployeeAddDialog({ onCancel, onCreated }: EmployeeAddDialogProps) {
  const [form, setForm] = useState<EmployeeCreateFormState>(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Same unmount guard as employee-edit-form.tsx: a POST can resolve after the panel has been
  // cancelled/unmounted (e.g. the user navigated away mid-request). Once unmounted we must not call
  // onCreated/setError/setSubmitting.
  const cancelledRef = useRef(false)
  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
    }
  }, [])

  function set<K extends keyof EmployeeCreateFormState>(key: K, value: EmployeeCreateFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    // Defensive double-submit guard beyond the disabled attribute.
    if (submitting) return

    const result = buildEmployeeCreate(form)
    if ('error' in result) {
      setError(result.error)
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(result),
      })
      if (cancelledRef.current) return
      if (res.status >= 200 && res.status < 300) {
        const created = (await res.json()) as EmployeeProfileData
        if (cancelledRef.current) return
        onCreated(created)
        return
      }
      setError(
        mutationErrorMessage(res.status, {
          badRequest: 'Nieprawidłowe dane — sprawdź PESEL, etat i wymagane pola.',
        }),
      )
    } catch {
      if (cancelledRef.current) return
      setError('Brak połączenia. Sprawdź internet i spróbuj ponownie.')
    } finally {
      if (!cancelledRef.current) setSubmitting(false)
    }
  }

  return (
    <Card className="p-5 mb-[22px]">
      <h2 className="font-display font-bold text-[17px] tracking-tightish text-navy mb-4">
        Dodaj pracownika
      </h2>
      <form onSubmit={submit} noValidate>
        {error ? (
          <div
            role="alert"
            className="mb-4 rounded-sm border border-error/30 bg-error/[0.06] px-3 py-2.5 text-[13px] text-error"
          >
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Imię" htmlFor="ea-first">
            <Input
              id="ea-first"
              value={form.firstName}
              onChange={(e) => set('firstName', e.target.value)}
              required
            />
          </Field>
          <Field label="Nazwisko" htmlFor="ea-last">
            <Input
              id="ea-last"
              value={form.lastName}
              onChange={(e) => set('lastName', e.target.value)}
              required
            />
          </Field>
        </div>

        <Field label="Stanowisko" htmlFor="ea-position">
          <Input
            id="ea-position"
            value={form.position}
            onChange={(e) => set('position', e.target.value)}
            required
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Typ umowy" htmlFor="ea-employment-type">
            <select
              id="ea-employment-type"
              value={form.employmentType}
              onChange={(e) => set('employmentType', e.target.value)}
              className={employeeSelectClass}
            >
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {contractLabel(t)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Jednostka" htmlFor="ea-unit">
            <select
              id="ea-unit"
              value={form.unitId}
              onChange={(e) => set('unitId', e.target.value)}
              className={employeeSelectClass}
            >
              <option value="">Wybierz jednostkę…</option>
              {UNIT_OPTIONS.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Data zatrudnienia" htmlFor="ea-hired-at">
            <Input
              id="ea-hired-at"
              type="date"
              value={form.hiredAt}
              onChange={(e) => set('hiredAt', e.target.value)}
              required
            />
          </Field>
          <Field label="Etat" htmlFor="ea-etat" hint="Domyślnie 1 (pełny etat), jeśli puste">
            <Input
              id="ea-etat"
              type="number"
              step={0.05}
              min={0}
              max={1}
              placeholder="1.0"
              value={form.etat}
              onChange={(e) => set('etat', e.target.value)}
            />
          </Field>
        </div>

        <Field label="Kwalifikacje" htmlFor="ea-quals" hint="Oddziel przecinkami, opcjonalnie">
          <Input
            id="ea-quals"
            value={form.qualifications}
            onChange={(e) => set('qualifications', e.target.value)}
            placeholder="np. Prawo jazdy kat. B, Obsługa wózka widłowego"
          />
        </Field>

        <Field label="PESEL" htmlFor="ea-pesel" hint="Wymagane, dokładnie 11 cyfr">
          <Input
            id="ea-pesel"
            inputMode="numeric"
            value={form.pesel}
            onChange={(e) => set('pesel', e.target.value)}
            placeholder="11 cyfr"
            maxLength={11}
            required
          />
        </Field>

        <div className="flex items-center justify-end gap-2.5 mt-1">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
            Anuluj
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Dodawanie…' : 'Dodaj pracownika'}
          </Button>
        </div>
      </form>
    </Card>
  )
}
