'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, Th, Td } from '@/components/ui/table'
import { Field, Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { employeeSelectClass } from '@/lib/employee-profile'
import { IconCheck, IconClose, IconPlus } from '@/components/icons'
import type { Role } from '@/lib/nav'
import {
  wnioskiApi,
  leaveActions,
  leaveStatusLabel,
  leaveTypeLabel,
  validateLeaveRange,
  buildLeaveEnrichMap,
  enrichLeavesWith,
  WnioskiApiError,
  LEAVE_TYPES,
  type EnrichedLeave,
  type LeaveStatus,
  type LeaveAction,
} from '@/lib/wnioski'

const POLL_MS = 6000

const STATUS_TONE: Record<LeaveStatus, 'ok' | 'warn' | 'muted' | 'default'> = {
  PENDING: 'warn',
  APPROVED: 'ok',
  REJECTED: 'muted',
  CANCELLED: 'muted',
}

function StatusBadge({ status }: { status: LeaveStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{leaveStatusLabel(status)}</Badge>
}

/** "01.08.2026" from a `YYYY-MM-DD[...]` date string — matches lib/ai-grafik.ts's dd.mm formatting habit. */
function formatDate(iso: string): string {
  const d = iso.slice(0, 10)
  const [y, m, day] = d.split('-')
  if (!y || !m || !day) return d
  return `${day}.${m}.${y}`
}

/** Surface the backend's already-humanized message (maker-checker 403, status-conflict 409, …). */
function actionErrorMessage(err: unknown): string {
  if (err instanceof WnioskiApiError) return err.message || 'Coś poszło nie tak. Spróbuj ponownie.'
  return 'Brak połączenia z serwerem. Spróbuj ponownie.'
}

interface FormState {
  type: string
  startDate: string
  endDate: string
}

const EMPTY_FORM: FormState = { type: LEAVE_TYPES[0], startDate: '', endDate: '' }

/**
 * Wnioski (leave-request) screen: two role-gated sections, mirroring components/ai-grafik/
 * proposal-inbox.tsx's polling-inbox pattern.
 *
 *   A. "Moje wnioski" (everyone) — a create form (type/start/end; `CreateLeaveDto` has NO `reason`
 *      field — that only exists on the decision, see below — so the form doesn't collect one), gated
 *      on {@link validateLeaveRange}, plus the caller's own requests with a cancel button while
 *      PENDING. Once decided, the row's "Uzasadnienie" column shows the decider's optional note.
 *   B. "Do akceptacji" (MANAGER/HR/ADMIN_KLIENTA only) — the PENDING inbox in the caller's scope
 *      (backend-scoped: MANAGER sees managed units, HR/ADMIN sees all) with Zatwierdź/Odrzuć. A
 *      maker-checker 403 (deciding one's own request) surfaces as the same friendly error banner as
 *      any other backend rejection — the backend has the final say, this screen never pre-filters it.
 *
 * The backend returns `employeeId` only (RODO allowlist — no PESEL/home, ever); both sections' rows
 * are enriched to names via `/api/employees` client-side (lib/wnioski.ts's buildLeaveEnrichMap).
 */
export function WnioskiScreen({ roles }: { roles: Role[] }) {
  const canManage = roles.some((r) => r === 'MANAGER' || r === 'HR' || r === 'ADMIN_KLIENTA')

  const [mine, setMine] = useState<EnrichedLeave[]>([])
  const [inbox, setInbox] = useState<EnrichedLeave[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [polling, setPolling] = useState(true)

  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const cancelledRef = useRef(false)
  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
    }
  }, [])

  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [mineRaw, inboxRaw] = await Promise.all([
        wnioskiApi.listRaw({ mine: true }),
        canManage ? wnioskiApi.listRaw({ state: 'PENDING' }) : Promise.resolve([]),
      ])
      if (cancelledRef.current) return

      const empName = await buildLeaveEnrichMap()
      if (cancelledRef.current) return

      setMine(enrichLeavesWith(mineRaw, empName))
      setInbox(enrichLeavesWith(inboxRaw, empName))
      setError(null)
    } catch (e) {
      if (!cancelledRef.current) setError(actionErrorMessage(e))
    } finally {
      if (!cancelledRef.current) setLoading(false)
    }
  }, [canManage])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!polling) {
      if (timer.current) clearInterval(timer.current)
      timer.current = null
      return
    }
    timer.current = setInterval(() => void refresh(), POLL_MS)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [polling, refresh])

  const run = useCallback(
    async (id: string, action: LeaveAction) => {
      const key = `${id}:${action}`
      setBusy((prev) => new Set(prev).add(key))
      setError(null)
      try {
        switch (action) {
          case 'approve':
            await wnioskiApi.decide(id, true)
            break
          case 'reject':
            await wnioskiApi.decide(id, false)
            break
          case 'cancel':
            await wnioskiApi.cancel(id)
            break
        }
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

  const rangeValid = validateLeaveRange(form.startDate, form.endDate)

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!rangeValid) return
    setCreating(true)
    setCreateError(null)
    try {
      await wnioskiApi.create({ type: form.type, startDate: form.startDate, endDate: form.endDate })
      if (!cancelledRef.current) setForm(EMPTY_FORM)
      await refresh()
    } catch (e) {
      if (!cancelledRef.current) setCreateError(actionErrorMessage(e))
    } finally {
      if (!cancelledRef.current) setCreating(false)
    }
  }

  if (loading) return <div className="grid place-items-center py-24 text-muted text-sm">Ładowanie…</div>

  return (
    <div className="max-w-[1120px] mx-auto">
      <div className="flex items-end justify-between gap-4 mb-[22px]">
        <div>
          <h1 className="font-display font-extrabold text-[26px] tracking-tightish text-navy leading-tight">
            Wnioski
          </h1>
          <p className="text-muted text-sm mt-1.5">
            Wnioski urlopowe: zgłoszenie, status i obieg akceptacji.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setPolling((p) => !p)}
          className="inline-flex items-center gap-2 h-9 px-3 rounded-full border border-line-strong bg-card text-[11px] font-mono uppercase tracking-[.06em] text-muted hover:bg-card-2"
          aria-pressed={polling}
        >
          <span className={`w-2 h-2 rounded-full ${polling ? 'bg-verified animate-pulse' : 'bg-muted-2'}`} />
          {polling ? 'Auto-odświeżanie · 6 s' : 'Wstrzymane'}
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 text-sm text-warn border border-warn/30 bg-warn/[0.08] rounded-lg px-3.5 py-2.5"
        >
          {error}
        </div>
      )}

      {/* Sekcja A: moje wnioski */}
      <section className="mb-8">
        <h2 className="font-display font-bold text-[17px] text-navy mb-2.5">Moje wnioski</h2>

        <Card className="p-4 mb-4">
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <Field label="Rodzaj" htmlFor="leaveType" className="mb-0">
              <select
                id="leaveType"
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                className={employeeSelectClass}
              >
                {LEAVE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {leaveTypeLabel(t)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Od" htmlFor="leaveStart" className="mb-0">
              <Input
                id="leaveStart"
                type="date"
                value={form.startDate}
                invalid={form.startDate !== '' && form.endDate !== '' && !rangeValid}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              />
            </Field>
            <Field label="Do" htmlFor="leaveEnd" className="mb-0">
              <Input
                id="leaveEnd"
                type="date"
                value={form.endDate}
                invalid={form.startDate !== '' && form.endDate !== '' && !rangeValid}
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
              />
            </Field>
            <Button type="submit" disabled={!rangeValid || creating} className="h-11">
              <IconPlus className="w-4 h-4" strokeWidth={2} />
              {creating ? 'Wysyłanie…' : 'Złóż wniosek'}
            </Button>
          </form>
          {form.startDate !== '' && form.endDate !== '' && !rangeValid && (
            <p className="text-warn text-[13px] mt-2">Data „Do" nie może być wcześniejsza niż „Od".</p>
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

        {mine.length === 0 ? (
          <EmptyRow text="Nie masz jeszcze żadnych wniosków." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Rodzaj</Th>
                <Th>Termin</Th>
                <Th>Status</Th>
                <Th>Uzasadnienie</Th>
                <Th className="text-right pr-4">Akcja</Th>
              </tr>
            </thead>
            <tbody>
              {mine.map((l) => {
                const actions = leaveActions(l.status, 'owner')
                return (
                  <tr key={l.id}>
                    <Td>{leaveTypeLabel(l.type)}</Td>
                    <Td>
                      {formatDate(l.startDate)} – {formatDate(l.endDate)}
                    </Td>
                    <Td>
                      <StatusBadge status={l.status} />
                    </Td>
                    <Td className="text-muted-2">{l.reason ?? '—'}</Td>
                    <Td className="text-right pr-4">
                      {actions.length > 0 ? (
                        <Button
                          variant="ghost"
                          className="h-8 px-3 text-[13px]"
                          onClick={() => void run(l.id, 'cancel')}
                          disabled={busy.has(`${l.id}:cancel`)}
                        >
                          <IconClose className="w-4 h-4" strokeWidth={2} />
                          Anuluj
                        </Button>
                      ) : (
                        <span className="text-muted-2 text-xs">—</span>
                      )}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </section>

      {/* Sekcja B: do akceptacji (manager/HR/admin) */}
      {canManage && (
        <section>
          <h2 className="font-display font-bold text-[17px] text-navy mb-2.5">Do akceptacji</h2>
          {inbox.length === 0 ? (
            <EmptyRow text="Brak wniosków oczekujących na decyzję." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Pracownik</Th>
                  <Th>Rodzaj</Th>
                  <Th>Termin</Th>
                  <Th className="text-right pr-4">Decyzja</Th>
                </tr>
              </thead>
              <tbody>
                {inbox.map((l) => {
                  const actions = leaveActions(l.status, 'decider')
                  return (
                    <tr key={l.id}>
                      <Td className="font-medium">{l.employeeName}</Td>
                      <Td>{leaveTypeLabel(l.type)}</Td>
                      <Td>
                        {formatDate(l.startDate)} – {formatDate(l.endDate)}
                      </Td>
                      <Td className="text-right pr-4">
                        {actions.length > 0 ? (
                          <div className="inline-flex items-center gap-2 justify-end">
                            {actions.map((a) => (
                              <Button
                                key={a.action}
                                variant={a.action === 'reject' ? 'ghost' : 'primary'}
                                className="h-8 px-3 text-[13px]"
                                onClick={() => void run(l.id, a.action)}
                                disabled={busy.has(`${l.id}:${a.action}`)}
                              >
                                {a.action === 'approve' && <IconCheck className="w-4 h-4" strokeWidth={2} />}
                                {a.action === 'reject' && <IconClose className="w-4 h-4" strokeWidth={2} />}
                                {a.label}
                              </Button>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-2 text-xs">—</span>
                        )}
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          )}
        </section>
      )}
    </div>
  )
}

function EmptyRow({ text }: { text: string }) {
  return <Card className="px-4 py-6 text-sm text-muted text-center">{text}</Card>
}
