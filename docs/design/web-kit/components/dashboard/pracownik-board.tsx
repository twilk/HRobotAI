'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { IconCalendar, IconRequests, IconArrowRight } from '@/components/icons'
import {
  shiftHours,
  weekRange,
  upcomingShifts,
  hoursInRange,
  weeklyTargetHours,
  leaveSummary,
  fmtShiftDay,
} from '@/lib/pracownik-dashboard'

/**
 * PRACOWNIK "safe signals" dashboard board — the role-adaptive `/dashboard`'s body for a plain
 * worker (see app/(tenant)/dashboard/page.tsx and
 * docs/superpowers/specs/2026-07-14-role-dashboards-component-audit.md §B1/§E-5).
 *
 * Deliberately carries NO computed performance/trajectory score: GDPR Art. 22 forbids showing a data
 * subject a purely automated ranking with no human-reviewed context. Only factual self-service
 * signals: my next shifts, my hours this week vs. my own etat, my leave request counts.
 *
 * Mirrors components/ai-grafik/ai-consent-section.tsx's fetch/cancelledRef/loading/error shape, but
 * this is a one-shot load (no polling) — the board is a compact "next actions" surface, not a live
 * approval queue.
 */

interface MeResponse {
  firstName: string
  lastName: string
  position: string | null
  etat: string | number
  unitId: string
}

interface ShiftRow {
  id: string
  lokalizacjaId: string
  date: string
  start: string
  end: string
  role: string
}

interface LocationRow {
  id: string
  name: string
}

interface LeaveRow {
  status: string
  startDate: string
  endDate: string
  type: string
}

interface BoardData {
  me: MeResponse
  shifts: ShiftRow[]
  locationNames: Map<string, string>
  leaves: LeaveRow[]
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`${url} -> ${res.status}`)
  return (await res.json()) as T
}

/** Today's date as `YYYY-MM-DD`, UTC — matches the pure helpers' date convention. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function PracownikBoard() {
  const [data, setData] = useState<BoardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cancelledRef = useRef(false)
  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const [me, shifts, locations, leaves] = await Promise.all([
          fetchJson<MeResponse>('/api/employees/me'),
          fetchJson<ShiftRow[]>('/api/grafik/shifts'),
          fetchJson<LocationRow[]>('/api/grafik/lokalizacje'),
          fetchJson<LeaveRow[]>('/api/wnioski'),
        ])
        if (cancelledRef.current) return
        const locationNames = new Map(locations.map((l) => [l.id, l.name]))
        setData({ me, shifts, locationNames, leaves })
        setError(null)
      } catch {
        if (!cancelledRef.current) setError('Brak połączenia z serwerem. Spróbuj ponownie.')
      } finally {
        if (!cancelledRef.current) setLoading(false)
      }
    })()
  }, [])

  if (loading) return <div className="grid place-items-center py-24 text-muted text-sm">Ładowanie…</div>

  if (error) {
    return (
      <div role="alert" className="text-sm text-warn border border-warn/30 bg-warn/[0.08] rounded-lg px-3.5 py-2.5">
        {error}
      </div>
    )
  }

  if (!data) return null

  const today = todayIso()
  const next = upcomingShifts(data.shifts, today, 5)
  const { from, to } = weekRange(today)
  const hoursThisWeek = hoursInRange(data.shifts, from, to)
  const targetHours = weeklyTargetHours(data.me.etat)
  const leaves = leaveSummary(data.leaves)

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card className="p-5 md:col-span-2">
        <h2 className="flex items-center gap-2.5 text-base font-semibold tracking-tightish mb-3">
          <IconCalendar className="w-[17px] h-[17px] text-accent-ink" strokeWidth={1.7} />
          Moje najbliższe zmiany
        </h2>
        {next.length === 0 ? (
          <p className="text-sm text-muted">Brak nadchodzących zmian.</p>
        ) : (
          <ul className="divide-y divide-line">
            {next.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2.5">
                <span className="font-mono text-[12px] text-muted-2 w-[64px] shrink-0">{fmtShiftDay(s.date)}</span>
                <span className="text-[13.5px] font-medium">
                  {s.start}–{s.end}
                </span>
                <span className="text-[13px] text-muted">{s.role}</span>
                <span className="ml-auto text-[12.5px] text-muted-2">
                  {data.locationNames.get(s.lokalizacjaId) ?? '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="text-base font-semibold tracking-tightish mb-1.5">Moje godziny w tym tygodniu</h2>
        <div className="mt-2 font-display font-extrabold text-[30px] leading-none text-navy tabular-nums">
          {hoursThisWeek.toFixed(1)} <span className="text-[15px] text-muted-2 font-normal">/ {targetHours.toFixed(0)} h</span>
        </div>
        <p className="mt-1.5 text-[12.5px] text-muted-2">
          Cel tygodniowy wynika z Twojego etatu ({from}–{to}).
        </p>
      </Card>

      <Card className="p-5">
        <h2 className="flex items-center gap-2.5 text-base font-semibold tracking-tightish mb-3">
          <IconRequests className="w-[17px] h-[17px] text-accent-ink" strokeWidth={1.7} />
          Mój urlop
        </h2>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <div className="font-display font-extrabold text-[22px] text-verified tabular-nums">{leaves.approved}</div>
            <div className="text-[11px] text-muted-2 mt-0.5">zatwierdzone</div>
          </div>
          <div>
            <div className="font-display font-extrabold text-[22px] text-warn tabular-nums">{leaves.pending}</div>
            <div className="text-[11px] text-muted-2 mt-0.5">oczekujące</div>
          </div>
          <div>
            <div className="font-display font-extrabold text-[22px] text-muted-2 tabular-nums">{leaves.rejected}</div>
            <div className="text-[11px] text-muted-2 mt-0.5">odrzucone</div>
          </div>
        </div>
        <Link
          href="/wnioski"
          className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent-ink"
        >
          Złóż wniosek
          <IconArrowRight className="w-[15px] h-[15px]" strokeWidth={2} />
        </Link>
      </Card>
    </div>
  )
}
