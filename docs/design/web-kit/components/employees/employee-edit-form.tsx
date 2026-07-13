'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { contractLabel } from '@/components/employees/employees-screen'
import { DEMO_UNIT_NAMES, unitName } from '@/lib/demo-locations'
import { buildEmployeePatch, type EmployeeEditFormState, type EmployeeProfileData } from '@/lib/employee-profile'

/** The 4 real `employmentType` enum values (tenant-runtime `UpdateEmployeeDto`/Prisma schema).
 *  Labelled with the exact same `contractLabel` map employees-screen.tsx and the read-only profile
 *  card already use, so the select's wording matches what's shown elsewhere. */
const EMPLOYMENT_TYPES = ['UMOWA_O_PRACE', 'UMOWA_ZLECENIE', 'UMOWA_O_DZIELO', 'B2B'] as const

/** Organizational units for the unitId select. `Unit` has no list endpoint yet (same gap as
 *  lib/demo-locations.ts's location map), so this reuses the exact same DEMO_UNIT_NAMES record the
 *  read-only card's `unitName()` lookup is built from — the only real source of unit ids in web-kit. */
const UNIT_OPTIONS = Object.entries(DEMO_UNIT_NAMES).map(([id, label]) => ({ id, label }))

const selectClass =
  'w-full h-11 px-[13px] rounded-sm border border-line-strong bg-card text-[14.5px] text-ink focus:outline-none focus:border-accent'

export interface EmployeeEditFormProps {
  profile: EmployeeProfileData
  onCancel: () => void
  /** Called with the FULL updated SAFE_SELECT employee returned by `PATCH /api/employees/:id` — no
   *  pesel is ever present on this object, so the caller can safely swap it straight into state. */
  onSaved: (updated: EmployeeProfileData) => void
}

/**
 * HR/ADMIN_KLIENTA-only edit form for the employee profile (Task 3b). Rendered by
 * employee-profile.tsx in place of the read-only card body when `canManage` and the user clicked
 * "Edytuj". Mirrors the form primitives (Field/Input, raw `<select>`) and mutating-fetch idiom
 * (fetch → status switch → setError) already used by components/auth/signup-form.tsx and
 * components/grafik/shift-editor.tsx — nothing new invented here.
 */
export function EmployeeEditForm({ profile, onCancel, onSaved }: EmployeeEditFormProps) {
  const [form, setForm] = useState<EmployeeEditFormState>({
    firstName: profile.firstName,
    lastName: profile.lastName,
    position: profile.position,
    employmentType: profile.employmentType,
    unitId: profile.unitId,
    etat: String(profile.etat),
    qualifications: profile.qualifications.join(', '),
    // Never prefilled — the backend never returns pesel, and this stays blank unless the user
    // deliberately types a replacement (write-only, RODO).
    pesel: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Tied to the component lifetime: an in-flight PATCH can resolve after the App Router has swapped
  // this mounted EmployeeProfile to a DIFFERENT employee (the id prop changed). Once unmounted we
  // must NOT call onSaved/setError/setSubmitting — otherwise employee A's save splices into
  // employee B's card. `cancelledRef` is checked after every await.
  const cancelledRef = useRef(false)
  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
    }
  }, [])

  function set<K extends keyof EmployeeEditFormState>(key: K, value: EmployeeEditFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  // Unit options for the select. If the current employee's unit isn't one of the known demo units,
  // synthesize a leading option for it (mirroring unitName()'s short-uuid fallback) so the displayed
  // selection always matches the REAL unit — otherwise the <select> would show a misleading default
  // and a save could silently reassign the employee to the wrong unit.
  const unitOptions =
    form.unitId in DEMO_UNIT_NAMES
      ? UNIT_OPTIONS
      : [{ id: form.unitId, label: unitName(form.unitId) }, ...UNIT_OPTIONS]

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    // Defensive double-submit guard beyond the disabled attribute.
    if (submitting) return

    // Explicit client-side validation: <form noValidate> makes required/min/max decorative, and
    // Number('') === 0 would let a cleared Etat silently PATCH etat to 0. Block those here.
    const firstName = form.firstName.trim()
    const lastName = form.lastName.trim()
    const position = form.position.trim()
    const etat = Number(form.etat)
    if (!firstName || !lastName || !position) {
      setError('Imię, nazwisko i stanowisko są wymagane.')
      return
    }
    if (form.etat.trim() === '' || !Number.isFinite(etat) || etat < 0 || etat > 1) {
      setError('Etat musi być liczbą w zakresie 0–1.')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/employees/${profile.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildEmployeePatch(form, profile)),
      })
      if (cancelledRef.current) return
      if (res.status >= 200 && res.status < 300) {
        const updated = (await res.json()) as EmployeeProfileData
        if (cancelledRef.current) return
        onSaved(updated)
        return
      }
      if (res.status === 400) {
        setError('Nieprawidłowe dane, sprawdź PESEL/etat.')
        return
      }
      if (res.status === 403) {
        setError('Brak uprawnień.')
        return
      }
      if (res.status === 409) {
        setError('Pracownik z tym numerem PESEL już istnieje.')
        return
      }
      setError('Coś poszło nie tak. Spróbuj ponownie.')
    } catch {
      if (cancelledRef.current) return
      setError('Brak połączenia. Sprawdź internet i spróbuj ponownie.')
    } finally {
      if (!cancelledRef.current) setSubmitting(false)
    }
  }

  return (
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
        <Field label="Imię" htmlFor="ee-first">
          <Input
            id="ee-first"
            value={form.firstName}
            onChange={(e) => set('firstName', e.target.value)}
            required
          />
        </Field>
        <Field label="Nazwisko" htmlFor="ee-last">
          <Input
            id="ee-last"
            value={form.lastName}
            onChange={(e) => set('lastName', e.target.value)}
            required
          />
        </Field>
      </div>

      <Field label="Stanowisko" htmlFor="ee-position">
        <Input
          id="ee-position"
          value={form.position}
          onChange={(e) => set('position', e.target.value)}
          required
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Typ umowy" htmlFor="ee-employment-type">
          <select
            id="ee-employment-type"
            value={form.employmentType}
            onChange={(e) => set('employmentType', e.target.value)}
            className={selectClass}
          >
            {EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {contractLabel(t)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Jednostka" htmlFor="ee-unit">
          <select
            id="ee-unit"
            value={form.unitId}
            onChange={(e) => set('unitId', e.target.value)}
            className={selectClass}
          >
            {unitOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Etat" htmlFor="ee-etat" hint="Ułamek etatu, np. 1 (pełny) lub 0,5 (pół etatu)">
        <Input
          id="ee-etat"
          type="number"
          step={0.05}
          min={0}
          max={1}
          value={form.etat}
          onChange={(e) => set('etat', e.target.value)}
          required
        />
      </Field>

      <Field label="Kwalifikacje" htmlFor="ee-quals" hint="Oddziel przecinkami">
        <Input
          id="ee-quals"
          value={form.qualifications}
          onChange={(e) => set('qualifications', e.target.value)}
          placeholder="np. Prawo jazdy kat. B, Obsługa wózka widłowego"
        />
      </Field>

      <Field
        label="PESEL"
        htmlFor="ee-pesel"
        hint="Tylko HR/Admin klienta; pozostaw puste, aby nie zmieniać"
      >
        <Input
          id="ee-pesel"
          inputMode="numeric"
          value={form.pesel}
          onChange={(e) => set('pesel', e.target.value)}
          placeholder="Wpisz, aby zmienić (11 cyfr)"
          maxLength={11}
        />
      </Field>

      <div className="flex items-center justify-end gap-2.5 mt-1">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
          Anuluj
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Zapisywanie…' : 'Zapisz'}
        </Button>
      </div>
    </form>
  )
}
