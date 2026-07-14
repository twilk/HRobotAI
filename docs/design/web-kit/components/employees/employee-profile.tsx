'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { IconArrowRight, IconLock, IconUser } from '@/components/icons'
import { unitName } from '@/lib/demo-locations'
import { cn } from '@/lib/cn'
import { contractLabel } from '@/components/employees/employees-screen'
import { EmployeeEditForm } from '@/components/employees/employee-edit-form'
import {
  employeeInitials,
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
   * real `hrobot_roles` claim). Gates the "Edytuj" affordance below (Task 3b) — a MANAGER/PRACOWNIK
   * viewing an in-scope profile gets the read-only card with no edit button at all.
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
export function EmployeeProfile({ id, canManage }: EmployeeProfileProps) {
  const [data, setData] = useState<EmployeeProfileData | null>(null)
  const [status, setStatus] = useState<ProfileStatus | 'loading'>('loading')
  const [editing, setEditing] = useState(false)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Reset before fetching so a changed `id` (without a remount) never briefly shows the previous
    // employee's card — including their masked PESEL row — while the new request is in flight.
    setData(null)
    setStatus('loading')
    setEditing(false)
    setSavedMessage(null)
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
      <EmptyState icon={IconLock} title="Brak dostępu do tego pracownika" actions={<BackToRoster />}>
        Ten pracownik jest poza Twoim zakresem (inna jednostka organizacyjna). Poproś HR lub Admina
        klienta o dostęp, jeśli to potrzebne.
      </EmptyState>
    )
  }

  if (status === 'not-found') {
    return (
      <EmptyState icon={IconUser} title="Nie znaleziono pracownika" actions={<BackToRoster />}>
        Ten pracownik nie istnieje albo został usunięty.
      </EmptyState>
    )
  }

  if (status === 'error' || !data) {
    return (
      <div className="max-w-[640px] mx-auto">
        <BackToRoster className="mb-4" />
        <div
          className="rounded-lg border border-error/30 bg-error/[0.05] px-4 py-3 text-[13.5px] text-ink"
          role="alert"
        >
          Nie udało się pobrać profilu pracownika.
        </div>
      </div>
    )
  }

  const pesel = maskPesel(data.peselLast4)

  return (
    <div className="max-w-[640px] mx-auto">
      <BackToRoster className="mb-4" />

      {savedMessage ? (
        <div
          role="status"
          className="mb-4 rounded-lg border border-verified/30 bg-verified/[0.06] px-4 py-3 text-[13.5px] text-ink"
        >
          {savedMessage}
        </div>
      ) : null}

      <Card className="p-5">
        <div className="flex items-center justify-between gap-[14px] mb-1 pb-4 border-b border-line">
          <div className="flex items-center gap-[14px]">
            <span className="grid place-items-center w-11 h-11 rounded-lg bg-gradient-to-b from-navy-700 to-navy text-white text-[13px] font-semibold shrink-0">
              {employeeInitials(data)}
            </span>
            <div>
              <h1 className="font-display font-extrabold text-[20px] tracking-tightish text-navy leading-tight">
                {data.firstName} {data.lastName}
              </h1>
              <p className="text-muted text-sm mt-0.5">{data.position}</p>
            </div>
          </div>
          {/* Edit affordance ONLY for an HR/ADMIN_KLIENTA session (canManage, computed server-side
              from the real hrobot_roles claim) — a MANAGER/PRACOWNIK never sees this button. */}
          {canManage && !editing ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setSavedMessage(null)
                setEditing(true)
              }}
              className="shrink-0"
            >
              Edytuj
            </Button>
          ) : null}
        </div>

        {editing ? (
          <div className="pt-4">
            <EmployeeEditForm
              profile={data}
              onCancel={() => setEditing(false)}
              onSaved={(updated) => {
                setData(updated)
                setEditing(false)
                setSavedMessage('Zapisano zmiany.')
              }}
            />
          </div>
        ) : (
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
        )}
      </Card>
    </div>
  )
}

/** Back-to-roster link, shown in every state (success + 403/404/error) so a user always has an
 *  in-app path back to the list — critical for the RBAC/unknown-id cases that land on 403/404. */
function BackToRoster({ className }: { className?: string }) {
  return (
    <Link
      href="/pracownicy"
      className={cn('inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent-ink', className)}
    >
      <IconArrowRight className="w-[15px] h-[15px] rotate-180" strokeWidth={2} />
      Wróć do listy
    </Link>
  )
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
