'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { IconArrowRight, IconLock, IconUser } from '@/components/icons'
import { unitName } from '@/lib/demo-locations'
import { contractLabel } from '@/components/employees/employees-screen'
import {
  etatLabel,
  formatHiredAt,
  maskPesel,
  profileStatusFromHttpStatus,
  type EmployeeProfileData,
  type ProfileStatus,
} from '@/lib/employee-profile'

export interface EmployeeProfileProps {
  id: string
  /**
   * HR/ADMIN_KLIENTA session (computed server-side in app/(tenant)/pracownicy/[id]/page.tsx from the
   * real `hrobot_roles` claim). Task 2b is read-only and doesn't use this yet — Task 3's edit form
   * will. Kept on the prop type (not destructured below) so the page's `<EmployeeProfile canManage>`
   * call needs no signature change later, and so this stays lint-clean with no unused binding now.
   */
  canManage?: boolean
}

/**
 * Read-only employee profile: fetches the real tenant-runtime employee through the authenticated
 * /api/employees/:id proxy (mirrors employees-screen.tsx's roster fetch). Renders the RODO-safe
 * projection only — no full PESEL, no home address ever reach this component, because the backend
 * never sends them (see employees.service.ts#getById). A masked `peselLast4` row appears only when
 * the backend included it (HR/ADMIN_KLIENTA actor); everyone else sees no PESEL row at all.
 */
export function EmployeeProfile({ id }: EmployeeProfileProps) {
  const [data, setData] = useState<EmployeeProfileData | null>(null)
  const [status, setStatus] = useState<ProfileStatus | 'loading'>('loading')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/employees/${id}`, { cache: 'no-store' })
        const resolved = profileStatusFromHttpStatus(res.status)
        if (resolved === 'ok') {
          const body = (await res.json()) as EmployeeProfileData
          if (!cancelled) {
            setData(body)
            setStatus('ok')
          }
        } else if (!cancelled) {
          setStatus(resolved)
        }
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  if (status === 'loading') {
    return <div className="grid place-items-center py-24 text-muted text-sm">Ładowanie profilu…</div>
  }

  if (status === 'forbidden') {
    return (
      <EmptyState icon={IconLock} title="Brak dostępu do tego pracownika">
        Ten pracownik jest poza Twoim zakresem (inna jednostka organizacyjna). Poproś HR lub Admina
        klienta o dostęp, jeśli to potrzebne.
      </EmptyState>
    )
  }

  if (status === 'not-found') {
    return (
      <EmptyState icon={IconUser} title="Nie znaleziono pracownika">
        Ten pracownik nie istnieje albo został usunięty.
      </EmptyState>
    )
  }

  if (status === 'error' || !data) {
    return (
      <div
        className="max-w-[640px] mx-auto rounded-lg border border-error/30 bg-error/[0.05] px-4 py-3 text-[13.5px] text-ink"
        role="alert"
      >
        Nie udało się pobrać profilu pracownika.
      </div>
    )
  }

  const pesel = maskPesel(data.peselLast4)

  return (
    <div className="max-w-[640px] mx-auto">
      <Link
        href="/pracownicy"
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent-ink mb-4"
      >
        <IconArrowRight className="w-[15px] h-[15px] rotate-180" strokeWidth={2} />
        Wróć do listy
      </Link>

      <Card className="p-5">
        <div className="flex items-center gap-[14px] mb-1 pb-4 border-b border-line">
          <span className="grid place-items-center w-11 h-11 rounded-lg bg-gradient-to-b from-navy-700 to-navy text-white text-[13px] font-semibold shrink-0">
            {initials(data)}
          </span>
          <div>
            <h1 className="font-display font-extrabold text-[20px] tracking-tightish text-navy leading-tight">
              {data.firstName} {data.lastName}
            </h1>
            <p className="text-muted text-sm mt-0.5">{data.position}</p>
          </div>
        </div>

        <div className="divide-y divide-line">
          <Row label="Jednostka" value={unitName(data.unitId)} />
          <Row label="Typ umowy" value={<Badge>{contractLabel(data.employmentType)}</Badge>} />
          <Row label="Etat" value={etatLabel(data.etat)} />
          <Row label="Data zatrudnienia" value={formatHiredAt(data.hiredAt)} />
          <Row
            label="Kwalifikacje"
            value={
              data.qualifications.length > 0 ? (
                <div className="flex flex-wrap justify-end gap-1.5">
                  {data.qualifications.map((q) => (
                    <Badge key={q} tone="muted">
                      {q}
                    </Badge>
                  ))}
                </div>
              ) : (
                <span className="text-muted-2">—</span>
              )
            }
          />
          {pesel ? (
            <Row
              label="PESEL"
              value={
                <span
                  className="font-mono text-[12.5px] tabular-nums text-muted"
                  title="Widoczne tylko dla HR / Admina klienta (RODO)"
                >
                  {pesel}
                </span>
              }
            />
          ) : null}
        </div>
      </Card>
    </div>
  )
}

function initials(e: Pick<EmployeeProfileData, 'firstName' | 'lastName'>): string {
  return (e.firstName.charAt(0) + e.lastName.charAt(0)).toUpperCase()
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-[11px]">
      <span className="font-mono text-[10.5px] tracking-[.08em] uppercase text-muted-2 pt-0.5 shrink-0">
        {label}
      </span>
      <span className="text-[13.5px] text-ink text-right">{value}</span>
    </div>
  )
}
