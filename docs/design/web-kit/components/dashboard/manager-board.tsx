'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { IconRequests, IconCalendar, IconArrowRight, IconKey } from '@/components/icons'
import { formatMoney } from '@/lib/koszty'
import {
  mondayOf,
  addDaysIso,
  decisionTotal,
  sortDecisions,
  type DecisionItem,
} from '@/lib/manager-dashboard'

/**
 * MANAGER "operational, scoped" dashboard board — the role-adaptive `/dashboard`'s body for a
 * MANAGER who isn't also HR/ADMIN_KLIENTA (see app/(tenant)/dashboard/page.tsx). Three sections:
 *
 *  a. "Skrzynka decyzji" — a single glanceable queue combining pending wnioski, shift-swaps and AI
 *     proposals, each linking to its own screen for the real action.
 *  b. "Wyjątki obsady" — vacated shifts (approved leave over an assigned shift) in the next 14 days,
 *     via the same `/ai-grafik/replacements/scan` the manager's AI Grafik screen uses (read-only scan,
 *     no mutation from this board).
 *  c. "Koszt jednostki" — this week's cost + budget status for the manager's first unit, reusing
 *     lib/koszty.ts's `formatMoney`/`kosztyApi.getWeek` (Codex P1-3: a MANAGER call MUST pass unitId).
 *
 * Mirrors components/dashboard/pracownik-board.tsx's fetch/cancelledRef/loading/error/Card shape. Each
 * tile degrades independently — a failed/403 endpoint just hides its section rather than erroring the
 * whole board, since a MANAGER's unit/role scoping can legitimately make some of these empty.
 */

interface WniosekRow {
  status: string
}
interface SwapRow {
  id: string
}
interface ProposalRow {
  id: string
}
interface UnitRow {
  id: string
  name: string
}
interface VacatedShiftRow {
  id: string
}
interface WeekCostRow {
  cost: string | number | null
  currency: string | null
  cap: string | number | null
  overBudget: boolean | null
  missingRates: unknown[]
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init })
  if (!res.ok) throw new Error(`${url} -> ${res.status}`)
  return (await res.json()) as T
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

interface DecisionData {
  items: DecisionItem[]
  total: number
}

interface CostData {
  unitName: string
  week: WeekCostRow
}

export function ManagerBoard() {
  const [decisions, setDecisions] = useState<DecisionData | null>(null)
  const [decisionsError, setDecisionsError] = useState(false)

  const [exceptionsCount, setExceptionsCount] = useState<number | null>(null)
  const [exceptionsError, setExceptionsError] = useState(false)

  const [cost, setCost] = useState<CostData | null>(null)
  const [costUnavailable, setCostUnavailable] = useState(false)

  const [loading, setLoading] = useState(true)

  const cancelledRef = useRef(false)
  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
    }
  }, [])

  useEffect(() => {
    const today = todayIso()

    void (async () => {
      try {
        const [wnioski, swaps, proposals] = await Promise.all([
          fetchJson<WniosekRow[]>('/api/wnioski'),
          fetchJson<SwapRow[]>('/api/shift-swap?state=PENDING_MANAGER'),
          fetchJson<ProposalRow[]>('/api/ai-grafik/proposals?state=PENDING_MANAGER'),
        ])
        if (cancelledRef.current) return
        const counts = {
          wnioski: wnioski.filter((w) => w.status === 'PENDING').length,
          swaps: swaps.length,
          proposals: proposals.length,
        }
        const items = sortDecisions([
          { key: 'wnioski', label: 'Wnioski', count: counts.wnioski, href: '/wnioski' },
          { key: 'swaps', label: 'Zamiany', count: counts.swaps, href: '/zamiany' },
          { key: 'proposals', label: 'Propozycje AI', count: counts.proposals, href: '/ai-grafik-manager' },
        ])
        setDecisions({ items, total: decisionTotal(counts) })
      } catch {
        if (!cancelledRef.current) setDecisionsError(true)
      }
    })()

    void (async () => {
      try {
        const vacated = await fetchJson<VacatedShiftRow[]>('/api/ai-grafik/replacements/scan', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ from: today, to: addDaysIso(today, 14) }),
        })
        if (cancelledRef.current) return
        setExceptionsCount(vacated.length)
      } catch {
        if (!cancelledRef.current) setExceptionsError(true)
      }
    })()

    void (async () => {
      try {
        const units = await fetchJson<UnitRow[]>('/api/grafik/units')
        if (units.length === 0) return
        const unit = units[0]
        const week = await fetchJson<WeekCostRow>(
          `/api/koszty/week?unitId=${unit.id}&weekStart=${mondayOf(today)}`,
        )
        if (cancelledRef.current) return
        setCost({ unitName: unit.name, week })
      } catch {
        if (!cancelledRef.current) setCostUnavailable(true)
      }
    })()

    setLoading(false)
  }, [])

  if (loading) return <div className="grid place-items-center py-24 text-muted text-sm">Ładowanie…</div>

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card className="p-5 md:col-span-2">
        <h2 className="flex items-center gap-2.5 text-base font-semibold tracking-tightish mb-3">
          <IconRequests className="w-[17px] h-[17px] text-accent-ink" strokeWidth={1.7} />
          Skrzynka decyzji
          {decisions && decisions.total > 0 && (
            <span className="ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-accent-ink text-white text-[11px] font-semibold tabular-nums">
              {decisions.total}
            </span>
          )}
        </h2>
        {decisionsError ? (
          <p className="text-sm text-muted">Brak połączenia z serwerem. Spróbuj ponownie.</p>
        ) : !decisions ? (
          <p className="text-sm text-muted">Ładowanie…</p>
        ) : decisions.total === 0 ? (
          <p className="text-sm text-muted">Brak spraw do zrobienia. Wszystko obsłużone.</p>
        ) : (
          <ul className="divide-y divide-line">
            {decisions.items.map((item) => (
              <li key={item.key} className="flex items-center gap-3 py-2.5">
                <span className="text-[13.5px] font-medium">{item.label}</span>
                <span className="font-mono text-[12px] text-muted-2 tabular-nums">{item.count}</span>
                <Link
                  href={item.href}
                  className="ml-auto inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent-ink"
                >
                  Przejdź
                  <IconArrowRight className="w-[14px] h-[14px]" strokeWidth={2} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="flex items-center gap-2.5 text-base font-semibold tracking-tightish mb-3">
          <IconCalendar className="w-[17px] h-[17px] text-accent-ink" strokeWidth={1.7} />
          Wyjątki obsady (najbliższe 14 dni)
        </h2>
        {exceptionsError ? (
          <p className="text-sm text-muted">Brak połączenia z serwerem. Spróbuj ponownie.</p>
        ) : exceptionsCount === null ? (
          <p className="text-sm text-muted">Ładowanie…</p>
        ) : exceptionsCount === 0 ? (
          <p className="text-sm text-muted">Brak zagrożeń obsady.</p>
        ) : (
          <>
            <p className="text-sm">
              Zagrożona obsada: <span className="font-semibold tabular-nums">{exceptionsCount}</span>{' '}
              {exceptionsCount === 1 ? 'zmiana' : 'zmiany'} (urlop pracownika)
            </p>
            <Link
              href="/ai-grafik-manager"
              className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent-ink"
            >
              Przejdź do AI Grafik Manager
              <IconArrowRight className="w-[15px] h-[15px]" strokeWidth={2} />
            </Link>
          </>
        )}
      </Card>

      {!costUnavailable && (
        <Card className="p-5">
          <h2 className="flex items-center gap-2.5 text-base font-semibold tracking-tightish mb-3">
            <IconKey className="w-[17px] h-[17px] text-accent-ink" strokeWidth={1.7} />
            Koszt jednostki (ten tydzień)
          </h2>
          {!cost ? (
            <p className="text-sm text-muted">Ładowanie…</p>
          ) : (
            <>
              <div className="font-display font-extrabold text-[26px] leading-none text-navy tabular-nums">
                {formatMoney(cost.week.cost, cost.week.currency)}
              </div>
              <p className="mt-1.5 text-[12.5px] text-muted-2">{cost.unitName}</p>
              <span
                className={
                  'mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ' +
                  (cost.week.overBudget === true
                    ? 'bg-warn/[0.12] text-warn'
                    : cost.week.overBudget === false
                      ? 'bg-verified/[0.12] text-verified'
                      : 'bg-card-2 text-muted-2 border border-line')
                }
              >
                {cost.week.overBudget === true
                  ? 'PRZEKROCZONY'
                  : cost.week.overBudget === false
                    ? 'W BUDŻECIE'
                    : 'brak limitu'}
              </span>
            </>
          )}
        </Card>
      )}
    </div>
  )
}
