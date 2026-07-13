'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, Th, Td } from '@/components/ui/table'
import { Field, Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { employeeSelectClass } from '@/lib/employee-profile'
import { IconPlus, IconClose } from '@/components/icons'
import {
  dostepyApi,
  accessTypeLabel,
  accessStatusLabel,
  canRevoke,
  buildIssueBody,
  DostepyApiError,
  ACCESS_TYPES,
  EMPTY_ISSUE_FORM,
  type AccessGrant,
  type AccessStatus,
  type IssueFormState,
} from '@/lib/dostepy'

const STATUS_TONE: Record<AccessStatus, 'ok' | 'warn' | 'muted' | 'default'> = {
  ACTIVE: 'ok',
  REVOKED: 'muted',
  LOST: 'warn',
}

function StatusBadge({ status }: { status: AccessStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{accessStatusLabel(status)}</Badge>
}

/** "01.08.2026" from an ISO datetime string, or "—" for null — matches wnioski-screen.tsx's dd.mm.yyyy
 *  formatting habit. */
function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = iso.slice(0, 10)
  const [y, m, day] = d.split('-')
  if (!y || !m || !day) return d
  return `${day}.${m}.${y}`
}

/** Surface the backend's already-humanized message (RBAC 403, duplicate-identifier / already-revoked
 *  409, …) — `lib/dostepy.ts`'s `humanizeAccessError` has already translated the two English 409s. */
function actionErrorMessage(err: unknown): string {
  if (err instanceof DostepyApiError) return err.message || 'Coś poszło nie tak. Spróbuj ponownie.'
  return 'Brak połączenia z serwerem. Spróbuj ponownie.'
}

interface EmployeeOption {
  id: string
  firstName: string
  lastName: string
}

/**
 * Dostępy (access grants) screen: MANAGER/HR/ADMIN_KLIENTA only — the page (app/(tenant)/dostepy/
 * page.tsx) already gates who reaches this component (EmptyState+IconLock for anyone else), so no
 * internal role check here, mirroring components/ai-grafik/proposal-inbox.tsx's `canManage`-page-gated
 * shape (rather than wnioski-screen.tsx's self-gating, since Dostępy has no "everyone" section).
 *
 * Two sections:
 *   A. "Wydaj dostęp" — issue form: employee <select> (fetched from /api/employees — the ONLY place
 *      this screen enriches; the list below already carries a safe employee sub-object), type
 *      <select>, required label, optional identifier/lokalizacjaId/notes. A 409 (duplicate ACTIVE
 *      identifier) surfaces as a friendly banner via `humanizeAccessError`/the backend's own Polish
 *      message.
 *   B. "Lista dostępów" — every grant in the actor's scope (global sees all, MANAGER sees managed
 *      units — enforced server-side): employee name, type badge, identifier, status badge, issued/
 *      revoked dates, and a Revoke button (with an optional reason prompt) for ACTIVE rows. Revoking
 *      an already-revoked/lost grant (a stale row, race with another manager) surfaces the translated
 *      409 rather than a raw error.
 *
 * RODO: the backend's `ACCESS_SELECT` employee sub-object never carries PESEL/home address — nothing
 * PII beyond name is ever rendered here.
 */
export function DostepyScreen() {
  const [grants, setGrants] = useState<AccessGrant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())

  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [employeesError, setEmployeesError] = useState<string | null>(null)

  const [form, setForm] = useState<IssueFormState>(EMPTY_ISSUE_FORM)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Tied to the component's lifetime: the mount fetches (or a later action) can resolve after unmount
  // (mirrors ai-config-panel.tsx's cancelledRef guard).
  const cancelledRef = useRef(false)
  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const rows = await dostepyApi.list()
      if (!cancelledRef.current) {
        setGrants(rows)
        setError(null)
      }
    } catch (e) {
      if (!cancelledRef.current) setError(actionErrorMessage(e))
    } finally {
      if (!cancelledRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    dostepyApi
      .listEmployeesForSelect()
      .then((emps) => {
        if (!cancelledRef.current) setEmployees(emps)
      })
      .catch((e) => {
        if (!cancelledRef.current) setEmployeesError(actionErrorMessage(e))
      })
  }, [])

  const revoke = useCallback(
    async (id: string) => {
      const reason = window.prompt('Powód odwołania (opcjonalnie):')
      if (reason === null) return // user cancelled the prompt
      const key = `revoke:${id}`
      setBusy((prev) => new Set(prev).add(key))
      setError(null)
      try {
        await dostepyApi.revoke(id, reason.trim() || undefined)
        await refresh()
      } catch (e) {
        if (!cancelledRef.current) setError(actionErrorMessage(e))
      } finally {
        if (!cancelledRef.current) {
          setBusy((prev) => {
            const next = new Set(prev)
            next.delete(key)
            return next
          })
        }
      }
    },
    [refresh],
  )

  async function handleIssue(e: React.FormEvent) {
    e.preventDefault()
    const built = buildIssueBody(form)
    if ('error' in built) {
      setCreateError(built.error)
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      await dostepyApi.issue(built)
      if (!cancelledRef.current) setForm(EMPTY_ISSUE_FORM)
      await refresh()
    } catch (e) {
      if (!cancelledRef.current) setCreateError(actionErrorMessage(e))
    } finally {
      if (!cancelledRef.current) setCreating(false)
    }
  }

  function patch(next: Partial<IssueFormState>) {
    setCreateError(null)
    setForm((f) => ({ ...f, ...next }))
  }

  if (loading) return <div className="grid place-items-center py-24 text-muted text-sm">Ładowanie…</div>

  return (
    <div className="max-w-[1120px] mx-auto">
      <div className="mb-[22px]">
        <h1 className="font-display font-extrabold text-[26px] tracking-tightish text-navy leading-tight">
          Dostępy
        </h1>
        <p className="text-muted text-sm mt-1.5">
          Karty, klucze i uprawnienia fizyczne: wydawanie i odwoływanie w zakresie Twoich jednostek.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 text-sm text-warn border border-warn/30 bg-warn/[0.08] rounded-lg px-3.5 py-2.5"
        >
          {error}
        </div>
      )}

      {/* Sekcja A: wydaj dostęp */}
      <section className="mb-8">
        <h2 className="font-display font-bold text-[17px] text-navy mb-2.5">Wydaj dostęp</h2>
        <Card className="p-4">
          <form onSubmit={handleIssue} className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Pracownik" htmlFor="accessEmployee" className="mb-0">
              <select
                id="accessEmployee"
                value={form.employeeId}
                onChange={(e) => patch({ employeeId: e.target.value })}
                className={employeeSelectClass}
              >
                <option value="">Wybierz…</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.firstName} {emp.lastName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Rodzaj" htmlFor="accessType" className="mb-0">
              <select
                id="accessType"
                value={form.type}
                onChange={(e) => patch({ type: e.target.value as IssueFormState['type'] })}
                className={employeeSelectClass}
              >
                {ACCESS_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {accessTypeLabel(t)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Etykieta" htmlFor="accessLabel" className="mb-0" hint="Np. „Karta biura głównego”.">
              <Input
                id="accessLabel"
                value={form.label}
                onChange={(e) => patch({ label: e.target.value })}
                placeholder="Karta biura głównego"
              />
            </Field>
            <Field label="Identyfikator" htmlFor="accessIdentifier" className="mb-0" hint="Numer karty/klucza (opcjonalnie).">
              <Input
                id="accessIdentifier"
                value={form.identifier}
                onChange={(e) => patch({ identifier: e.target.value })}
                placeholder="KART-00123"
              />
            </Field>
            <Field label="Lokalizacja" htmlFor="accessLokalizacja" className="mb-0" hint="ID lokalizacji, UUID (opcjonalnie).">
              <Input
                id="accessLokalizacja"
                value={form.lokalizacjaId}
                onChange={(e) => patch({ lokalizacjaId: e.target.value })}
                placeholder="uuid lokalizacji"
              />
            </Field>
            <Field label="Notatki" htmlFor="accessNotes" className="mb-0" hint="Opcjonalnie.">
              <Input
                id="accessNotes"
                value={form.notes}
                onChange={(e) => patch({ notes: e.target.value })}
                placeholder="Uwagi"
              />
            </Field>
            <div className="md:col-span-3 flex justify-end">
              <Button type="submit" disabled={creating} className="h-11">
                <IconPlus className="w-4 h-4" strokeWidth={2} />
                {creating ? 'Wydawanie…' : 'Wydaj dostęp'}
              </Button>
            </div>
          </form>
          {employeesError && (
            <div
              role="alert"
              className="mt-3 text-sm text-warn border border-warn/30 bg-warn/[0.08] rounded-lg px-3.5 py-2.5"
            >
              Nie udało się wczytać listy pracowników: {employeesError}
            </div>
          )}
          {createError && (
            <div
              role="alert"
              className="mt-3 text-sm text-warn border border-warn/30 bg-warn/[0.08] rounded-lg px-3.5 py-2.5"
            >
              {createError}
            </div>
          )}
        </Card>
      </section>

      {/* Sekcja B: lista dostępów */}
      <section>
        <h2 className="font-display font-bold text-[17px] text-navy mb-2.5">Lista dostępów</h2>
        {grants.length === 0 ? (
          <EmptyRow text="Brak wydanych dostępów w Twoim zakresie." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Pracownik</Th>
                <Th>Rodzaj</Th>
                <Th>Etykieta / identyfikator</Th>
                <Th>Status</Th>
                <Th>Wydano</Th>
                <Th>Odwołano</Th>
                <Th className="text-right pr-4">Akcja</Th>
              </tr>
            </thead>
            <tbody>
              {grants.map((g) => (
                <tr key={g.id}>
                  <Td className="font-medium">
                    {g.employee.firstName} {g.employee.lastName}
                  </Td>
                  <Td>{accessTypeLabel(g.type)}</Td>
                  <Td>
                    <div>{g.label}</div>
                    {g.identifier ? <div className="text-[11.5px] text-muted-2">{g.identifier}</div> : null}
                  </Td>
                  <Td>
                    <StatusBadge status={g.status} />
                  </Td>
                  <Td>{formatDate(g.issuedAt)}</Td>
                  <Td>{formatDate(g.revokedAt)}</Td>
                  <Td className="text-right pr-4">
                    {canRevoke(g.status) ? (
                      <Button
                        variant="ghost"
                        className="h-8 px-3 text-[13px]"
                        onClick={() => void revoke(g.id)}
                        disabled={busy.has(`revoke:${g.id}`)}
                      >
                        <IconClose className="w-4 h-4" strokeWidth={2} />
                        Odwołaj
                      </Button>
                    ) : (
                      <span className="text-muted-2 text-xs">—</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  )
}

function EmptyRow({ text }: { text: string }) {
  return <Card className="px-4 py-6 text-sm text-muted text-center">{text}</Card>
}
