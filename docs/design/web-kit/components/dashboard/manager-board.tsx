'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { IconRequests, IconCalendar, IconArrowRight, IconKey, IconShield } from '@/components/icons'
import { formatMoney } from '@/lib/koszty'
import { fmtShiftDay } from '@/lib/pracownik-dashboard'
import {
  mondayOf,
  addDaysIso,
  decisionTotal,
  sortDecisions,
  topVacated,
  vacatedWho,
  type DecisionItem,
  type VacatedShiftView,
} from '@/lib/manager-dashboard'

/**
 * MANAGER "operational, scoped" dashboard board — the role-adaptive `/dashboard`'s body for a
 * MANAGER who isn't also HR/ADMIN_KLIENTA (see app/(tenant)/dashboard/page.tsx). Sections, in this
 * order (audit §E-6, OBOWIĄZUJĄCA: exceptions are the manager's primary job, so they lead):
 *
 *  a. "Wyjątki obsady (14 dni)" — the actual vacated shifts (approved leave over an assigned shift),
 *     LISTED with who/when/where (not just a count), via the same `/ai-grafik/replacements/scan` the
 *     AI Grafik screen uses (read-only). Empty → a positive "obsada zabezpieczona" health state.
 *  b. "Skrzynka decyzji" — a glanceable queue of pending wnioski/swaps/AI-proposals, count>0 first.
 *  c. "Koszt jednostki" — this week's cost + budget status for the manager's first unit.
 *
 * Mirrors pracownik-board.tsx's fetch/cancelledRef/error/Card shape. Each tile degrades independently —
 * a failed/403 endpoint hides its section rather than erroring the whole board.
 */

interface WniosekRow {
  status: string
}
interface UnitRow {
  id: string
  name: string
}
interface LokRow {
  id: string
  name: string
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
interface ExceptionsData {
  shifts: VacatedShiftView[]
  lokName: Map<string, string>
}

export function ManagerBoard() {
  const [decisions, setDecisions] = useState<DecisionData | null>(null)
  const [decisionsError, setDecisionsError] = useState(false)

  const [exceptions, setExceptions] = useState<ExceptionsData | null>(null)
  const [exceptionsError, setExceptionsError] = useState(false)

  const [cost, setCost] = useState<CostData | null>(null)
  const [costUnavailable, setCostUnavailable] = useState(false)

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
          fetchJson<{ id: string }[]>('/api/shift-swap?state=PENDING_MANAGER'),
          fetchJson<{ id: string }[]>('/api/ai-grafik/proposals?state=PENDING_MANAGER'),
        ])
        if (cancelledRef.current) return
        const counts = {
          wnioski: wnioski.filter((w) => w.status === 'PENDING').length,
          swaps: swaps.length,
          proposals: proposals.length,
        }
        setDecisions({
          items: sortDecisions([
            { key: 'wnioski', label: 'Wnioski do akceptacji', count: counts.wnioski, href: '/wnioski' },
            { key: 'swaps', label: 'Zamiany do zatwierdzenia', count: counts.swaps, href: '/zamiany' },
            { key: 'proposals', label: 'Propozycje AI zastępstw', count: counts.proposals, href: '/ai-grafik-manager' },
          ]),
          total: decisionTotal(counts),
        })
      } catch {
        if (!cancelledRef.current) setDecisionsError(true)
      }
    })()

    void (async () => {
      try {
        const [shifts, loks] = await Promise.all([
          fetchJson<VacatedShiftView[]>('/api/ai-grafik/replacements/scan', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ from: today, to: addDaysIso(today, 14) }),
          }),
          fetchJson<LokRow[]>('/api/grafik/lokalizacje').catch(() => [] as LokRow[]),
        ])
        if (cancelledRef.current) return
        setExceptions({ shifts, lokName: new Map(loks.map((l) => [l.id, l.name])) })
      } catch {
        if (!cancelledRef.current) setExceptionsError(true)
      }
    })()

    void (async () => {
      try {
        const units = await fetchJson<UnitRow[]>('/api/grafik/units')
        if (units.length === 0) {
          if (!cancelledRef.current) setCostUnavailable(true)
          return
        }
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
  }, [])

  const exc = exceptions ? topVacated(exceptions.shifts) : null

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {/* a. Wyjątki obsady — the hero panel */}
      <Card className="p-5 md:col-span-2">
        <h2 className="flex items-center gap-2.5 text-base font-semibold tracking-tightish mb-3">
          <IconCalendar className="w-[17px] h-[17px] text-accent-ink" strokeWidth={1.7} />
          Wyjątki obsady — najbliższe 14 dni
          {exc && exc.shown.length > 0 && (
            <span className="ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-warn text-white text-[11px] font-semibold tabular-nums">
              {exceptions!.shifts.length}
            </span>
          )}
        </h2>
        {exceptionsError ? (
          <p className="text-sm text-muted">Brak połączenia z serwerem. Spróbuj ponownie.</p>
        ) : !exc ? (
          <p className="text-sm text-muted">Ładowanie…</p>
        ) : exc.shown.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-verified">
            <IconShield className="w-[16px] h-[16px]" strokeWidth={1.8} />
            Obsada zabezpieczona — brak zagrożeń w najbliższych 14 dniach.
          </p>
        ) : (
          <>
            <p className="text-[13px] text-muted mb-2">
              Zmiany zagrożone urlopem przypisanego pracownika — wymagają zastępstwa:
            </p>
            <ul className="divide-y divide-line">
              {exc.shown.map((s) => (
                <li key={s.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-2">
                  <span className="text-[13.5px] font-semibold">{vacatedWho(s)}</span>
                  <span className="font-mono text-[12px] text-muted-2">{fmtShiftDay(s.date)}</span>
                  <span className="font-mono text-[12px] text-navy tabular-nums">
                    {s.start}–{s.end}
                  </span>
                  <span className="text-[12px] text-muted-2">{s.role}</span>
                  <span className="text-[12px] text-muted-2">
                    · {exceptions!.lokName.get(s.lokalizacjaId) ?? '—'}
                  </span>
                </li>
              ))}
            </ul>
            {exc.more > 0 && (
              <p className="mt-1.5 text-[12px] text-muted-2">+{exc.more} więcej</p>
            )}
            <Link
              href="/ai-grafik-manager"
              className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent-ink"
            >
              Znajdź zastępstwa (AI Grafik Manager)
              <IconArrowRight className="w-[15px] h-[15px]" strokeWidth={2} />
            </Link>
          </>
        )}
      </Card>

      {/* b. Skrzynka decyzji */}
      <Card className="p-5">
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
                {item.count > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-card-2 border border-line font-mono text-[11px] text-navy tabular-nums">
                    {item.count}
                  </span>
                )}
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

      {/* c. Koszt jednostki */}
      {!costUnavailable && (
        <Card className="p-5">
          <h2 className="flex items-center gap-2.5 text-base font-semibold tracking-tightish mb-3">
            <IconKey className="w-[17px] h-[17px] text-accent-ink" strokeWidth={1.7} />
            Koszt jednostki — ten tydzień
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
                    : 'brak limitu budżetu'}
              </span>
            </>
          )}
        </Card>
      )}
    </div>
  )
}
