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

/**
 * HR/ADMIN "governance first" dashboard board — the role-adaptive `/dashboard`'s body for a global
 * (HR or ADMIN_KLIENTA) caller, rendered BEFORE <DashboardKpis/> (see app/(tenant)/dashboard/page.tsx).
 * Deliberately just ONE section: "Zdrowie organizacji" — two structural-health signals (units missing a
 * manager, users missing any role). NOT an "AI feed" — no such engine exists yet (see the SP4 task doc).
 *
 * Mirrors components/dashboard/manager-board.tsx's per-tile degradation: the two signals come from
 * DIFFERENT RBAC scopes — `GET /ustawienia/units` is readable by MANAGER/HR/ADMIN_KLIENTA, but
 * `GET /uzytkownicy` is a deliberately ADMIN_KLIENTA-only whole-controller gate (see
 * apps/tenant-runtime/src/users/users.controller.ts's docstring — that gate is a LOCKED decision, not
 * changed here). So an HR caller (this board's other target audience per the commit doc) will always
 * 403 on the users read. Each tile therefore fetches and degrades independently: a failed/403
 * "Użytkownicy bez ról" tile just omits itself rather than blanking the whole "Zdrowie organizacji"
 * card, so HR still sees the units-without-manager signal it does have access to.
 */
export function AdminBoard() {
  const [unitsWithoutManager, setUnitsWithoutManager] = useState<number | null>(null)
  const [unitsError, setUnitsError] = useState(false)

  const [usersWithoutRoles, setUsersWithoutRoles] = useState<number | null>(null)
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
        const users = await fetchJson<UserRoleRow[]>('/api/uzytkownicy')
        if (cancelledRef.current) return
        setUsersWithoutRoles(countUsersWithoutRoles(users))
      } catch {
        // ADMIN_KLIENTA-only endpoint (403 for HR) or a genuine network failure — either way this
        // tile just hides itself, it never blanks the units-without-manager signal above.
        if (!cancelledRef.current) setUsersUnavailable(true)
      }
    })()
  }, [])

  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2.5 text-base font-semibold tracking-tightish mb-3">
        <IconShield className="w-[17px] h-[17px] text-accent-ink" strokeWidth={1.7} />
        Zdrowie organizacji
      </h2>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          {unitsError ? (
            <p className="text-sm text-muted">Brak połączenia z serwerem. Spróbuj ponownie.</p>
          ) : unitsWithoutManager === null ? (
            <p className="text-sm text-muted">Ładowanie…</p>
          ) : (
            <>
              <div
                className={
                  'font-display font-extrabold text-[26px] leading-none tabular-nums ' +
                  (unitsWithoutManager > 0 ? 'text-warn' : 'text-verified')
                }
              >
                {unitsWithoutManager}
              </div>
              <p className="mt-1 text-[13px] text-muted">Jednostki bez managera</p>
              <Link
                href="/ustawienia"
                className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent-ink"
              >
                Przejdź do ustawień
                <IconArrowRight className="w-[14px] h-[14px]" strokeWidth={2} />
              </Link>
            </>
          )}
        </div>
        {!usersUnavailable && (
          <div>
            {usersWithoutRoles === null ? (
              <p className="text-sm text-muted">Ładowanie…</p>
            ) : (
              <>
                <div
                  className={
                    'font-display font-extrabold text-[26px] leading-none tabular-nums ' +
                    (usersWithoutRoles > 0 ? 'text-warn' : 'text-verified')
                  }
                >
                  {usersWithoutRoles}
                </div>
                <p className="mt-1 text-[13px] text-muted">Użytkownicy bez ról</p>
                <Link
                  href="/ustawienia/uzytkownicy"
                  className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent-ink"
                >
                  Przejdź do użytkowników
                  <IconArrowRight className="w-[14px] h-[14px]" strokeWidth={2} />
                </Link>
              </>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}
