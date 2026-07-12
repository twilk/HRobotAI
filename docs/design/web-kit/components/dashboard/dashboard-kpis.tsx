'use client'

import { useEffect, useState } from 'react'
import { IconUsers, IconCalendar, IconRequests, IconKey } from '@/components/icons'

interface Kpis {
  employees: number | null
  units: number | null
  shifts: number | null
  pendingSwaps: number | null
}

async function count(url: string): Promise<{ n: number; rows: unknown[] } | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    const rows = (await res.json()) as unknown[]
    return { n: Array.isArray(rows) ? rows.length : 0, rows: Array.isArray(rows) ? rows : [] }
  } catch {
    return null
  }
}

/**
 * Live tenant KPIs pulled from the same-origin proxies (cookie-authenticated), so the dashboard
 * reflects the REAL tenant state (36 employees, planned shifts, pending swaps) instead of a static
 * onboarding checklist. Each tile degrades to "—" if its endpoint is unavailable for the current role.
 */
export function DashboardKpis() {
  const [kpis, setKpis] = useState<Kpis>({ employees: null, units: null, shifts: null, pendingSwaps: null })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [emp, shifts, swaps] = await Promise.all([
        count('/api/employees'),
        count('/api/grafik/shifts'),
        count('/api/shift-swap?state=PENDING_MANAGER'),
      ])
      if (cancelled) return
      const units = emp ? new Set(emp.rows.map((r) => (r as { unitId?: string }).unitId)).size : null
      setKpis({
        employees: emp?.n ?? null,
        units,
        shifts: shifts?.n ?? null,
        pendingSwaps: swaps?.n ?? null,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const tiles = [
    { icon: IconUsers, label: 'Pracownicy', value: kpis.employees, hint: 'aktywne kartoteki' },
    { icon: IconCalendar, label: 'Zaplanowane zmiany', value: kpis.shifts, hint: 'w grafiku' },
    { icon: IconRequests, label: 'Oczekujące zamiany', value: kpis.pendingSwaps, hint: 'do zatwierdzenia' },
    { icon: IconKey, label: 'Jednostki', value: kpis.units, hint: 'organizacyjne' },
  ]

  const fmt = (v: number | null) => (v === null ? '—' : String(v))

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-lg border border-line bg-card shadow-sm p-4">
          <div className="flex items-center gap-2 text-muted-2">
            <t.icon className="w-[18px] h-[18px]" strokeWidth={1.7} />
            <span className="font-mono text-[10.5px] tracking-[.08em] uppercase">{t.label}</span>
          </div>
          <div className="mt-2 font-display font-extrabold text-[30px] leading-none text-navy tabular-nums">
            {fmt(t.value)}
          </div>
          <div className="mt-1 text-[12px] text-muted-2">{t.hint}</div>
        </div>
      ))}
    </div>
  )
}
