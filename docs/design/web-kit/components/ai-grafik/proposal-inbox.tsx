'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, Th, Td } from '@/components/ui/table'
import { Field, Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { IconCheck, IconClose, IconSearch, IconSparkles, IconShieldCheck } from '@/components/icons'
import {
  aiProposalApi,
  fetchMyEmployeeId,
  aiProposalActions,
  proposalStateLabel,
  isMineToConsent,
  shiftLabelOf,
  AiGrafikApiError,
  type EnrichedProposal,
  type AiProposalState,
  type VacatedShift,
} from '@/lib/ai-grafik'
import { isoDate, addDays, mondayOf } from '@/lib/grafik'

const POLL_MS = 4000

const STATE_TONE: Record<AiProposalState, 'ok' | 'warn' | 'muted' | 'default'> = {
  DRAFT: 'muted',
  PENDING_EMPLOYEE_CONSENT: 'warn',
  EMPLOYEE_AGREED: 'default',
  PENDING_MANAGER: 'warn',
  APPROVED: 'ok',
  REJECTED: 'muted',
  ESCALATED: 'muted',
  CANCELLED: 'muted',
}

/** Lifecycle badge for an AI proposal, mirroring components/swaps/swap-badge.tsx's state→tone pattern. */
function ProposalBadge({ state }: { state: AiProposalState }) {
  return <Badge tone={STATE_TONE[state]}>{proposalStateLabel(state)}</Badge>
}

/**
 * Surface the backend's already-humanized message (AiGrafikApiError#message) rather than the
 * employee-domain PESEL/mutation copy — this screen has no employee/PESEL concept. Mirrors
 * ai-config-panel.tsx's configErrorMessage.
 */
function actionErrorMessage(err: unknown): string {
  if (err instanceof AiGrafikApiError) return err.message || 'Coś poszło nie tak. Spróbuj ponownie.'
  return 'Brak połączenia z serwerem. Spróbuj ponownie.'
}

/** Default scan window: the current ISO week (Monday..Sunday), a sensible demo default. */
function defaultScanRange(): { from: string; to: string } {
  const monday = mondayOf(new Date())
  return { from: isoDate(monday), to: isoDate(addDays(monday, 6)) }
}

type Action = 'approve' | 'reject' | 'accept' | 'decline'

/**
 * AI proposal inbox (Task 1.5) — mirrors components/swaps/swap-workspace.tsx: ~4s polling, per-state
 * action buttons, a `run(id, action)` dispatcher, state badges. Three sections:
 *
 *   A. "Skrzynka managera" (canManage only) — proposals in PENDING_MANAGER get Approve/Reject;
 *      DRAFT/ESCALATED proposals are listed with their status only (no action wired for those yet).
 *   B. "Twoja propozycja zmiany" — the current caller's own active PENDING consent request, if any
 *      (isMineToConsent). Visible to EVERY role, including a plain PRACOWNIK.
 *   C. "Wykrywanie wypadnięć" (canManage only) — scan a date range for vacated shifts, then create a
 *      replacement proposal per shift. This is what seeds the manager inbox in the demo.
 *
 * The backend never returns employee names (ids only); lib/ai-grafik.ts's aiProposalApi enriches
 * every proposal client-side. NEVER display PESEL/home — the backend already omits them everywhere
 * this screen reads from (SAFE_SELECT / RODO allowlist projections).
 */
export function ProposalInbox({ canManage }: { canManage: boolean }) {
  const [managerInbox, setManagerInbox] = useState<EnrichedProposal[]>([])
  const [myConsent, setMyConsent] = useState<EnrichedProposal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [polling, setPolling] = useState(true)

  const [scanRange, setScanRange] = useState(defaultScanRange)
  const [vacated, setVacated] = useState<VacatedShift[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [createdShiftIds, setCreatedShiftIds] = useState<ReadonlySet<string>>(new Set())

  // Tied to the component's lifetime: a poll tick (or the mount fetch) can resolve after unmount
  // (mirrors ai-config-panel.tsx's cancelledRef guard).
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
      const meId = await fetchMyEmployeeId()
      if (cancelledRef.current) return

      const [mine, manager] = await Promise.all([
        aiProposalApi.listProposals({ mine: true }),
        canManage
          ? Promise.all([
              aiProposalApi.listProposals({ state: 'PENDING_MANAGER' }),
              aiProposalApi.listProposals({ state: 'DRAFT' }),
              aiProposalApi.listProposals({ state: 'ESCALATED' }),
            ]).then(([pendingManager, draft, escalated]) => [...pendingManager, ...draft, ...escalated])
          : Promise.resolve<EnrichedProposal[]>([]),
      ])
      if (cancelledRef.current) return
      setMyConsent(mine.filter((p) => isMineToConsent(p, meId)))
      setManagerInbox(manager)
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
    async (id: string, action: Action) => {
      setBusy(`${id}:${action}`)
      setError(null)
      try {
        switch (action) {
          case 'approve':
            await aiProposalApi.managerDecision(id, true)
            break
          case 'reject':
            await aiProposalApi.managerDecision(id, false)
            break
          case 'accept':
            await aiProposalApi.consent(id, true)
            break
          case 'decline':
            await aiProposalApi.consent(id, false)
            break
        }
        await refresh()
      } catch (e) {
        if (!cancelledRef.current) setError(actionErrorMessage(e))
      } finally {
        if (!cancelledRef.current) setBusy(null)
      }
    },
    [refresh],
  )

  const runScan = useCallback(async () => {
    setScanning(true)
    setScanError(null)
    try {
      const shifts = await aiProposalApi.scan(scanRange.from, scanRange.to)
      if (!cancelledRef.current) {
        setVacated(shifts)
        setCreatedShiftIds(new Set())
      }
    } catch (e) {
      if (!cancelledRef.current) setScanError(actionErrorMessage(e))
    } finally {
      if (!cancelledRef.current) setScanning(false)
    }
  }, [scanRange])

  const createProposal = useCallback(
    async (shiftId: string) => {
      setBusy(`create:${shiftId}`)
      setScanError(null)
      try {
        await aiProposalApi.createForShift(shiftId)
        if (!cancelledRef.current) setCreatedShiftIds((prev) => new Set([...prev, shiftId]))
        await refresh()
      } catch (e) {
        if (!cancelledRef.current) setScanError(actionErrorMessage(e))
      } finally {
        if (!cancelledRef.current) setBusy(null)
      }
    },
    [refresh],
  )

  if (loading) return <div className="grid place-items-center py-24 text-muted text-sm">Ładowanie…</div>

  return (
    <div className="max-w-[1120px] mx-auto">
      <div className="flex items-end justify-between gap-4 mb-[22px]">
        <div>
          <h1 className="font-display font-extrabold text-[26px] tracking-tightish text-navy leading-tight">
            Propozycje AI
          </h1>
          <p className="text-muted text-sm mt-1.5">
            Zastępstwa proponowane przez AI: najpierw zgoda pracownika, potem zatwierdzenie managera.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setPolling((p) => !p)}
          className="inline-flex items-center gap-2 h-9 px-3 rounded-full border border-line-strong bg-card text-[11px] font-mono uppercase tracking-[.06em] text-muted hover:bg-card-2"
          aria-pressed={polling}
        >
          <span className={`w-2 h-2 rounded-full ${polling ? 'bg-verified animate-pulse' : 'bg-muted-2'}`} />
          {polling ? 'Auto-odświeżanie · 4 s' : 'Wstrzymane'}
        </button>
      </div>

      {error && (
        <div className="mb-4 text-sm text-warn border border-warn/30 bg-warn/[0.08] rounded-lg px-3.5 py-2.5">
          {error}
        </div>
      )}

      {/* Sekcja B: zgoda pracownika — widoczna dla każdej roli, w tym PRACOWNIKA */}
      <section className="mb-8">
        <h2 className="font-display font-bold text-[17px] text-navy mb-2.5">
          Twoja propozycja zmiany — wymaga zgody
        </h2>
        {myConsent.length === 0 ? (
          <EmptyRow text="Nie masz obecnie żadnej propozycji zastępstwa oczekującej na Twoją zgodę." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Zmiana do objęcia</Th>
                <Th>Status</Th>
                <Th className="text-right pr-4">Twoja decyzja</Th>
              </tr>
            </thead>
            <tbody>
              {myConsent.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <ShiftCell label={p.shiftLabel} sub={p.reason ?? 'Propozycja AI'} />
                  </Td>
                  <Td>
                    <ProposalBadge state={p.state} />
                  </Td>
                  <Td className="text-right pr-4">
                    <div className="inline-flex items-center gap-2 justify-end">
                      <Button
                        className="h-8 px-3 text-[13px]"
                        onClick={() => void run(p.id, 'accept')}
                        disabled={busy === `${p.id}:accept`}
                      >
                        <IconCheck className="w-4 h-4" strokeWidth={2} />
                        Akceptuj
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-8 px-3 text-[13px]"
                        onClick={() => void run(p.id, 'decline')}
                        disabled={busy === `${p.id}:decline`}
                      >
                        <IconClose className="w-4 h-4" strokeWidth={2} />
                        Odrzuć
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      {canManage && (
        <>
          {/* Sekcja A: skrzynka managera */}
          <section className="mb-8">
            <div className="flex items-center gap-2 mb-2.5">
              <h2 className="font-display font-bold text-[17px] text-navy">
                Skrzynka managera — propozycje do zatwierdzenia
              </h2>
              <span className="inline-flex items-center gap-1 text-[11px] text-muted">
                <IconShieldCheck className="w-3.5 h-3.5 text-accent-ink" strokeWidth={1.7} />
                zastępstwo trafia tu dopiero po zgodzie pracownika
              </span>
            </div>
            {managerInbox.length === 0 ? (
              <EmptyRow text="Brak propozycji AI oczekujących na decyzję." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Wakująca zmiana</Th>
                    <Th>Kandydat</Th>
                    <Th>Status</Th>
                    <Th className="text-right pr-4">Decyzja</Th>
                  </tr>
                </thead>
                <tbody>
                  {managerInbox.map((p) => {
                    const actions = aiProposalActions(p.state, 'manager')
                    const active = p.candidates.find((c) => c.id === p.activeCandidateId)
                    return (
                      <tr key={p.id}>
                        <Td>
                          <ShiftCell label={p.shiftLabel} sub={p.vacatedEmployeeName} />
                        </Td>
                        <Td>
                          {active ? (
                            <ShiftCell label={active.employeeName} sub={`ranga ${active.rank}`} />
                          ) : (
                            <span className="text-muted-2">—</span>
                          )}
                        </Td>
                        <Td>
                          <ProposalBadge state={p.state} />
                        </Td>
                        <Td className="text-right pr-4">
                          {actions.length > 0 ? (
                            <div className="inline-flex items-center gap-2 justify-end">
                              {actions.map((a) => (
                                <Button
                                  key={a.action}
                                  variant={a.action === 'reject' ? 'ghost' : 'primary'}
                                  className="h-8 px-3 text-[13px]"
                                  onClick={() => void run(p.id, a.action)}
                                  disabled={busy === `${p.id}:${a.action}`}
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

          {/* Sekcja C: wykrywanie wypadnięć + wyzwalanie propozycji */}
          <section>
            <h2 className="font-display font-bold text-[17px] text-navy mb-2.5">Wykrywanie wypadnięć</h2>
            <Card className="p-4 mb-4">
              <p className="text-sm text-muted mb-3">
                Znajdź zmiany, których przypisany pracownik ma zatwierdzony urlop w danym okresie.
              </p>
              <div className="flex items-end gap-3 flex-wrap">
                <Field label="Od" htmlFor="scanFrom" className="mb-0 w-[160px]">
                  <Input
                    id="scanFrom"
                    type="date"
                    value={scanRange.from}
                    onChange={(e) => setScanRange((r) => ({ ...r, from: e.target.value }))}
                  />
                </Field>
                <Field label="Do" htmlFor="scanTo" className="mb-0 w-[160px]">
                  <Input
                    id="scanTo"
                    type="date"
                    value={scanRange.to}
                    onChange={(e) => setScanRange((r) => ({ ...r, to: e.target.value }))}
                  />
                </Field>
                <Button className="h-11 px-3.5 text-sm" onClick={() => void runScan()} disabled={scanning}>
                  <IconSearch className="w-[17px] h-[17px]" strokeWidth={2} />
                  {scanning ? 'Skanowanie…' : 'Skanuj'}
                </Button>
              </div>
              {scanError && (
                <div className="mt-3 text-sm text-warn border border-warn/30 bg-warn/[0.08] rounded-lg px-3.5 py-2.5">
                  {scanError}
                </div>
              )}
            </Card>

            {vacated.length > 0 && (
              <Table>
                <thead>
                  <tr>
                    <Th>Wakująca zmiana</Th>
                    <Th>Pracownik na urlopie</Th>
                    <Th className="text-right pr-4">Akcja</Th>
                  </tr>
                </thead>
                <tbody>
                  {vacated.map((s) => {
                    const created = createdShiftIds.has(s.id)
                    return (
                      <tr key={s.id}>
                        <Td>
                          <ShiftCell label={shiftLabelOf(s)} sub={s.role} />
                        </Td>
                        <Td>
                          <ShiftCell
                            label={`${s.employee.firstName} ${s.employee.lastName}`}
                            sub={s.employee.position ?? '—'}
                          />
                        </Td>
                        <Td className="text-right pr-4">
                          {created ? (
                            <span className="text-verified text-xs font-medium">Utworzono propozycję</span>
                          ) : (
                            <Button
                              className="h-8 px-3 text-[13px]"
                              onClick={() => void createProposal(s.id)}
                              disabled={busy === `create:${s.id}`}
                            >
                              <IconSparkles className="w-4 h-4" strokeWidth={2} />
                              Utwórz propozycję zastępstwa
                            </Button>
                          )}
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function ShiftCell({ label, sub }: { label: string; sub: string }) {
  return (
    <div>
      <div className="font-medium text-[13.5px]">{label}</div>
      <div className="text-[11.5px] text-muted-2">{sub}</div>
    </div>
  )
}

function EmptyRow({ text }: { text: string }) {
  return <Card className="px-4 py-6 text-sm text-muted text-center">{text}</Card>
}
