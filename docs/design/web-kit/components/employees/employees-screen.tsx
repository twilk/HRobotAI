'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { EmployeesTable, type Employee } from '@/components/employees/employees-table'
import { EmployeesEmpty } from '@/components/employees/employees-empty'
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

/** Polish contract label from the DB employmentType enum. */
function contractLabel(t: string): string {
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

/**
 * Real employee roster: fetches the tenant-runtime roster through the same-origin /api/employees
 * proxy (cookie-authenticated), so Pracownicy shows the SAME people as Grafik — not a static mock.
 */
export function EmployeesScreen() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/employees', { cache: 'no-store' })
        if (!res.ok) throw new Error(`Nie udało się pobrać pracowników (HTTP ${res.status}).`)
        const rows = (await res.json()) as ApiEmployee[]
        if (!cancelled) setEmployees(rows.map(toEmployee))
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

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
  if (employees.length === 0) return <EmployeesEmpty />

  return (
    <div className="max-w-[1120px] mx-auto">
      <div className="flex items-end justify-between gap-4 mb-[22px]">
        <div>
          <h1 className="font-display font-extrabold text-[26px] tracking-tightish text-navy leading-tight">Pracownicy</h1>
          <p className="text-muted text-sm mt-1.5 whitespace-nowrap">
            {employees.length} osób · {unitCount} {unitCount === 1 ? 'jednostka organizacyjna' : 'jednostki organizacyjne'}
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
          <Button className="h-10 px-3.5 text-sm">
            <IconPlus className="w-[17px] h-[17px]" strokeWidth={1.8} />
            Dodaj pracownika
          </Button>
        </div>
      </div>
      <EmployeesTable employees={filtered} />
    </div>
  )
}
