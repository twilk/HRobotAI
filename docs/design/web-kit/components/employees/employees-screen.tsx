'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { EmployeesTable, type Employee } from '@/components/employees/employees-table'
import { EmployeesEmpty } from '@/components/employees/employees-empty'
import { EmployeeAddDialog } from '@/components/employees/employee-add-dialog'
import { IconPlus, IconSearch } from '@/components/icons'
import { unitName } from '@/lib/demo-locations'

/** Raw shape from tenant-runtime GET /api/employees (RODO: no PESEL, no email). */
interface ApiEmployee {
  id: string
  firstName: string
  lastName: string
  position: string
  employmentType: string
  unitId: string
}

/** Polish contract label from the DB employmentType enum. Exported so employee-profile.tsx reuses
 *  the exact same mapping instead of duplicating it. */
export function contractLabel(t: string): string {
  switch (t) {
    case 'UMOWA_O_PRACE':
      return 'UoP'
    case 'UMOWA_ZLECENIE':
      return 'Zlecenie'
    case 'UMOWA_O_DZIELO':
      return 'Dzieło'
    default:
      return t === 'B2B' ? 'B2B' : t
  }
}

function toEmployee(e: ApiEmployee): Employee {
  return {
    id: e.id,
    firstName: e.firstName,
    lastName: e.lastName,
    position: e.position,
    unit: unitName(e.unitId),
    contract: contractLabel(e.employmentType),
    // email/peselLast4/status intentionally omitted — the real API doesn't expose them (RODO).
  }
}

export interface EmployeesScreenProps {
  /** HR/ADMIN_KLIENTA session (computed server-side in app/(tenant)/pracownicy/page.tsx from the
   *  real `hrobot_roles` claim, mirroring the [id] profile page's `canManage`). Gates the "Dodaj
   *  pracownika" affordance (Task 4b) — a MANAGER/PRACOWNIK never sees the button or the form. */
  canManage?: boolean
  /** Show the PESEL column in the roster table. False for a plain PRACOWNIK (RODO: no PESEL for them
   *  → the column is only a placeholder). Computed server-side in the page from `hrobot_roles`. */
  showPesel?: boolean
}

/**
 * Real employee roster: fetches the tenant-runtime roster through the same-origin /api/employees
 * proxy (cookie-authenticated), so Pracownicy shows the SAME people as Grafik — not a static mock.
 */
export function EmployeesScreen({ canManage, showPesel = true }: EmployeesScreenProps) {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  // Distinct from `loading`: a post-create re-fetch must NOT trip the full-screen "Ładowanie…"
  // early-return (which would unmount the header/search/table, drop scroll + focus, and re-announce
  // the success banner). `refreshing` keeps the current roster on screen with only a subtle inline
  // hint while the background GET runs.
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [addedMessage, setAddedMessage] = useState<string | null>(null)

  // Tied to the component's lifetime: a re-fetch triggered after a create can resolve after unmount
  // (mirrors employee-edit-form.tsx's cancelledRef guard).
  const cancelledRef = useRef(false)
  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
    }
  }, [])

  // `initial` = the mount fetch (blank screen → full-screen spinner is fine). Any later refetch
  // (e.g. after a create) sets `refreshing` instead, so the current roster stays mounted.
  const fetchEmployees = useCallback(async ({ initial }: { initial?: boolean } = {}) => {
    if (initial) setLoading(true)
    else setRefreshing(true)
    setError(null)
    try {
      const res = await fetch('/api/employees', { cache: 'no-store' })
      if (!res.ok) throw new Error(`Nie udało się pobrać pracowników (HTTP ${res.status}).`)
      const rows = (await res.json()) as ApiEmployee[]
      if (!cancelledRef.current) setEmployees(rows.map(toEmployee))
    } catch (err) {
      if (!cancelledRef.current) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (!cancelledRef.current) {
        if (initial) setLoading(false)
        else setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    fetchEmployees({ initial: true })
  }, [fetchEmployees])

  function handleCreated() {
    setAdding(false)
    setAddedMessage('Dodano pracownika.')
    // Re-fetch rather than optimistically prepending the 201 response — this keeps the roster's
    // sort order/derived fields (unit name, contract label) consistent with a real GET, and is the
    // one source of truth the rest of this screen already trusts. Uses `refreshing` (not `loading`)
    // so the success banner + current table stay on screen instead of flashing the full spinner.
    fetchEmployees()
  }

  const unitCount = useMemo(() => new Set(employees.map((e) => e.unit)).size, [employees])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return employees
    return employees.filter((e) =>
      `${e.firstName} ${e.lastName} ${e.position} ${e.unit}`.toLowerCase().includes(q),
    )
  }, [employees, query])

  if (loading) return <div className="grid place-items-center py-24 text-muted text-sm">Ładowanie pracowników…</div>
  if (error)
    return (
      <div className="max-w-[1120px] mx-auto rounded-lg border border-error/30 bg-error/[0.05] px-4 py-3 text-[13.5px] text-ink" role="alert">
        {error}
      </div>
    )
  if (employees.length === 0)
    return (
      <div className="max-w-[1120px] mx-auto">
        {canManage && adding ? (
          <EmployeeAddDialog onCancel={() => setAdding(false)} onCreated={handleCreated} />
        ) : (
          <EmployeesEmpty canManage={canManage} onAdd={() => setAdding(true)} />
        )}
      </div>
    )

  return (
    <div className="max-w-[1120px] mx-auto">
      <div className="flex items-end justify-between gap-4 mb-[22px]">
        <div>
          <h1 className="font-display font-extrabold text-[26px] tracking-tightish text-navy leading-tight">Pracownicy</h1>
          <p className="text-muted text-sm mt-1.5 whitespace-nowrap">
            {employees.length} osób · {unitCount} {unitCount === 1 ? 'jednostka organizacyjna' : 'jednostki organizacyjne'}
            {refreshing ? <span className="text-muted-2"> · Odświeżanie…</span> : null}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="relative hidden sm:block">
            <IconSearch className="absolute left-[11px] top-[11px] w-[17px] h-[17px] text-muted-2" strokeWidth={1.7} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Szukaj pracownika"
              aria-label="Szukaj pracownika"
              className="h-10 pl-9 pr-3 w-[230px] rounded-sm border border-line-strong bg-card text-sm text-ink focus:outline-none focus:border-accent"
            />
          </div>
          {/* "Dodaj pracownika" ONLY for an HR/ADMIN_KLIENTA session (canManage, computed
              server-side in app/(tenant)/pracownicy/page.tsx from the real hrobot_roles claim) — a
              MANAGER/PRACOWNIK never sees this button at all. */}
          {canManage ? (
            <Button className="h-10 px-3.5 text-sm" onClick={() => setAdding(true)}>
              <IconPlus className="w-[17px] h-[17px]" strokeWidth={1.8} />
              Dodaj pracownika
            </Button>
          ) : null}
        </div>
      </div>

      {addedMessage ? (
        <div
          role="status"
          className="mb-4 rounded-lg border border-verified/30 bg-verified/[0.06] px-4 py-3 text-[13.5px] text-ink"
        >
          {addedMessage}
        </div>
      ) : null}

      {canManage && adding ? (
        <EmployeeAddDialog onCancel={() => setAdding(false)} onCreated={handleCreated} />
      ) : null}

      {/* Subtle dimming while a background refresh runs — the table stays mounted (scroll/focus kept),
          just visually de-emphasised, instead of being replaced by the full-screen spinner. */}
      <div className={refreshing ? 'opacity-60 transition-opacity' : 'transition-opacity'} aria-busy={refreshing}>
        <EmployeesTable employees={filtered} showPesel={showPesel} />
      </div>
    </div>
  )
}
