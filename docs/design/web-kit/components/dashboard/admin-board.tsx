'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { IconShield, IconArrowRight } from '@/components/icons'
import { buildUnitTree, type OrgUnit } from '@/lib/ustawienia'
import {
  countUnitsWithoutManager,
  countUsersWithoutRoles,
  countInactiveUsers,
  needsAttentionCount,
} from '@/lib/admin-dashboard'

interface UserRow {
  roles: unknown[]
  active?: boolean
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`${url} -> ${res.status}`)
  return (await res.json()) as T
}

/**
 * HR/ADMIN "governance first" dashboard board — the role-adaptive `/dashboard`'s body for a global
 * (HR or ADMIN_KLIENTA) caller, rendered BEFORE <DashboardKpis/> (see app/(tenant)/dashboard/page.tsx).
 * A single "Zdrowie organizacji" health card with a top-line verdict + up to three structural signals:
 * units missing a manager, users missing any role, deactivated accounts. NOT an "AI feed" — no such
 * engine exists yet (see the SP4 task doc); org-wide KPIs render below via <DashboardKpis/>.
 *
 * `GET /uzytkownicy` is ADMIN_KLIENTA-only (users.controller.ts — a LOCKED decision), so an HR caller
 * 403s on it; the two user signals then hide themselves and the verdict is computed from the units
 * signal alone, rather than blanking the whole card.
 */
export function AdminBoard() {
  const [unitsWithoutManager, setUnitsWithoutManager] = useState<number | null>(null)
  const [unitsError, setUnitsError] = useState(false)

  const [userSignals, setUserSignals] = useState<{ withoutRoles: number; inactive: number } | null>(null)
  const [usersUnavailable, setUsersUnavailable] = useState(false)

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
        const units = await fetchJson<OrgUnit[]>('/api/ustawienia/units')
        if (cancelledRef.current) return
        setUnitsWithoutManager(countUnitsWithoutManager(buildUnitTree(units)))
      } catch {
        if (!cancelledRef.current) setUnitsError(true)
      }
    })()

    void (async () => {
      try {
        const users = await fetchJson<UserRow[]>('/api/uzytkownicy')
        if (cancelledRef.current) return
        setUserSignals({ withoutRoles: countUsersWithoutRoles(users), inactive: countInactiveUsers(users) })
      } catch {
        // ADMIN_KLIENTA-only endpoint (403 for HR) or a network failure — hide the user signals.
        if (!cancelledRef.current) setUsersUnavailable(true)
      }
    })()
  }, [])

  const ready = unitsWithoutManager !== null && (userSignals !== null || usersUnavailable)
  const attention = ready
    ? needsAttentionCount({
        unitsWithoutManager: unitsWithoutManager ?? 0,
        usersWithoutRoles: userSignals?.withoutRoles ?? 0,
        inactiveUsers: userSignals?.inactive ?? 0,
      })
    : 0

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="flex items-center gap-2.5 text-base font-semibold tracking-tightish">
          <IconShield className="w-[17px] h-[17px] text-accent-ink" strokeWidth={1.7} />
          Zdrowie organizacji
        </h2>
        {ready && (
          <span
            className={
              'inline-flex items-center rounded-full px-2.5 py-1 text-[11.5px] font-semibold ' +
              (attention > 0 ? 'bg-warn/[0.12] text-warn' : 'bg-verified/[0.12] text-verified')
            }
          >
            {attention > 0
              ? `Wymaga uwagi: ${attention} ${attention === 1 ? 'obszar' : 'obszary'}`
              : 'Wszystko w porządku'}
          </span>
        )}
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <Signal
          error={unitsError}
          value={unitsWithoutManager}
          label="Jednostki bez managera"
          href="/ustawienia"
          hrefLabel="Ustawienia"
        />
        {!usersUnavailable && (
          <>
            <Signal
              value={userSignals?.withoutRoles ?? null}
              label="Użytkownicy bez ról"
              href="/ustawienia/uzytkownicy"
              hrefLabel="Użytkownicy"
            />
            <Signal
              value={userSignals?.inactive ?? null}
              label="Konta nieaktywne"
              href="/ustawienia/uzytkownicy"
              hrefLabel="Użytkownicy"
            />
          </>
        )}
      </div>
    </Card>
  )
}

function Signal({
  value,
  label,
  href,
  hrefLabel,
  error,
}: {
  value: number | null
  label: string
  href: string
  hrefLabel: string
  error?: boolean
}) {
  if (error) return <div className="text-sm text-muted">Brak połączenia z serwerem.</div>
  if (value === null) return <div className="text-sm text-muted">Ładowanie…</div>
  return (
    <div>
      <div
        className={
          'font-display font-extrabold text-[26px] leading-none tabular-nums ' +
          (value > 0 ? 'text-warn' : 'text-verified')
        }
      >
        {value}
      </div>
      <p className="mt-1 text-[13px] text-muted">{label}</p>
      <Link
        href={href}
        className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent-ink"
      >
        {hrefLabel}
        <IconArrowRight className="w-[14px] h-[14px]" strokeWidth={2} />
      </Link>
    </div>
  )
}
