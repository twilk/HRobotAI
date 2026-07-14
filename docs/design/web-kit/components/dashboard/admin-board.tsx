'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { IconShield, IconArrowRight } from '@/components/icons'
import { buildUnitTree, type OrgUnit } from '@/lib/ustawienia'
import { countUnitsWithoutManager, countUsersWithoutRoles } from '@/lib/admin-dashboard'

interface UserRoleRow {
  roles: unknown[]
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`${url} -> ${res.status}`)
  return (await res.json()) as T
}

interface HealthData {
  unitsWithoutManager: number
  usersWithoutRoles: number
}

/**
 * HR/ADMIN "governance first" dashboard board — the role-adaptive `/dashboard`'s body for a global
 * (HR or ADMIN_KLIENTA) caller, rendered BEFORE <DashboardKpis/> (see app/(tenant)/dashboard/page.tsx).
 * Deliberately just ONE section: "Zdrowie organizacji" — two structural-health signals (units missing a
 * manager, users missing any role) that are cheap to compute from data these roles already have full
 * read access to, and that a governance-first landing should surface ahead of raw KPI counts. NOT an
 * "AI feed" — no such engine exists yet (see the SP4 task doc).
 *
 * Mirrors components/dashboard/pracownik-board.tsx's fetch/cancelledRef/loading/error/Card shape. A
 * failed endpoint degrades the whole card to an error line rather than partially rendering one signal —
 * both reads come from admin-only endpoints so a failure here means auth/network trouble, not a
 * per-tile RBAC gap.
 */
export function AdminBoard() {
  const [data, setData] = useState<HealthData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

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
        const [units, users] = await Promise.all([
          fetchJson<OrgUnit[]>('/api/ustawienia/units'),
          fetchJson<UserRoleRow[]>('/api/uzytkownicy'),
        ])
        if (cancelledRef.current) return
        const tree = buildUnitTree(units)
        setData({
          unitsWithoutManager: countUnitsWithoutManager(tree),
          usersWithoutRoles: countUsersWithoutRoles(users),
        })
        setError(null)
      } catch {
        if (!cancelledRef.current) setError('Brak połączenia z serwerem. Spróbuj ponownie.')
      } finally {
        if (!cancelledRef.current) setLoading(false)
      }
    })()
  }, [])

  if (loading) return <div className="grid place-items-center py-16 text-muted text-sm">Ładowanie…</div>

  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2.5 text-base font-semibold tracking-tightish mb-3">
        <IconShield className="w-[17px] h-[17px] text-accent-ink" strokeWidth={1.7} />
        Zdrowie organizacji
      </h2>
      {error ? (
        <div role="alert" className="text-sm text-warn border border-warn/30 bg-warn/[0.08] rounded-lg px-3.5 py-2.5">
          {error}
        </div>
      ) : !data ? null : (
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <div
              className={
                'font-display font-extrabold text-[26px] leading-none tabular-nums ' +
                (data.unitsWithoutManager > 0 ? 'text-warn' : 'text-verified')
              }
            >
              {data.unitsWithoutManager}
            </div>
            <p className="mt-1 text-[13px] text-muted">Jednostki bez managera</p>
            <Link
              href="/ustawienia"
              className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent-ink"
            >
              Przejdź do ustawień
              <IconArrowRight className="w-[14px] h-[14px]" strokeWidth={2} />
            </Link>
          </div>
          <div>
            <div
              className={
                'font-display font-extrabold text-[26px] leading-none tabular-nums ' +
                (data.usersWithoutRoles > 0 ? 'text-warn' : 'text-verified')
              }
            >
              {data.usersWithoutRoles}
            </div>
            <p className="mt-1 text-[13px] text-muted">Użytkownicy bez ról</p>
            <Link
              href="/ustawienia/uzytkownicy"
              className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent-ink"
            >
              Przejdź do użytkowników
              <IconArrowRight className="w-[14px] h-[14px]" strokeWidth={2} />
            </Link>
          </div>
        </div>
      )}
    </Card>
  )
}
