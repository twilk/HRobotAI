'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, Th, Td } from '@/components/ui/table'
import { IconPlus, IconCheck, IconClose, IconArrowRight, IconShieldCheck } from '@/components/icons'
import { swapApi, TERMINAL_STATES, type SwapRequest } from '@/lib/swaps'
import { grafikApi } from '@/lib/grafik'
import { SwapBadge } from './swap-badge'

const POLL_MS = 4000

/** Actions offered per state in "my requests"; the backend RBAC + state machine have the final say. */
function mineActions(r: SwapRequest): Array<{ act: string; label: string; variant?: 'primary' | 'ghost' }> {
  switch (r.state) {
    case 'DRAFT':
      return [
        { act: 'submit', label: 'Wyślij' },
        { act: 'cancel', label: 'Anuluj', variant: 'ghost' },
      ]
    case 'PENDING_PEER':
      return r.mineRole === 'target'
        ? [
            { act: 'peer-accept', label: 'Akceptuj' },
            { act: 'peer-reject', label: 'Odrzuć', variant: 'ghost' },
          ]
        : [{ act: 'cancel', label: 'Anuluj', variant: 'ghost' }]
    case 'PEER_AGREED':
      return [
        { act: 'to-manager', label: 'Przekaż managerowi' },
        { act: 'cancel', label: 'Anuluj', variant: 'ghost' },
      ]
    case 'PENDING_MANAGER':
      return [{ act: 'cancel', label: 'Anuluj', variant: 'ghost' }]
    default:
      return []
  }
}

export function SwapWorkspace() {
  const [mine, setMine] = useState<SwapRequest[]>([])
  const [inbox, setInbox] = useState<SwapRequest[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [polling, setPolling] = useState(true)
  const [proposing, setProposing] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async () => {
    const [m, i] = await Promise.all([swapApi.list({ mine: true }), swapApi.list({ state: 'PENDING_MANAGER' })])
    setMine(m)
    setInbox(i)
  }, [])

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
    async (id: string, act: string) => {
      setBusy(`${id}:${act}`)
      setError(null)
      try {
        switch (act) {
          case 'submit':
            await swapApi.submit(id)
            break
          case 'peer-accept':
            await swapApi.peerDecision(id, true)
            break
          case 'peer-reject':
            await swapApi.peerDecision(id, false)
            break
          case 'to-manager':
            await swapApi.submitToManager(id)
            break
          case 'approve':
            await swapApi.managerDecision(id, true)
            break
          case 'reject':
            await swapApi.managerDecision(id, false)
            break
          case 'cancel':
            await swapApi.cancel(id)
            break
        }
        await refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Akcja nie powiodła się')
      } finally {
        setBusy(null)
      }
    },
    [refresh],
  )

  const propose = useCallback(async () => {
    setBusy('propose')
    setError(null)
    try {
      // Standalone demo shortcut. In the product this is launched from the grafik grid with the two
      // selected shifts pre-filled; here we pull two real shifts (different employees) from the live
      // grafik API and create against the backend. The backend enforces that the requester shift must
      // belong to the CALLER's own Employee (RBAC) — so this surfaces a real 403 for a user with no
      // Employee record, exactly as the state machine intends.
      const shifts = await grafikApi.shifts()
      if (shifts.length === 0) throw new Error('Brak zmian w grafiku do zaproponowania zamiany.')
      const requesterShift = shifts[0]
      const targetShift = shifts.find((s) => s.employeeId !== requesterShift.employeeId)
      await swapApi.create({
        requesterShiftId: requesterShift.id,
        targetShiftId: targetShift?.id,
      })
      setProposing(false)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się utworzyć propozycji zamiany')
    } finally {
      setBusy(null)
    }
  }, [refresh])

  return (
    <div className="max-w-[1120px] mx-auto">
      <div className="flex items-end justify-between gap-4 mb-[22px]">
        <div>
          <h1 className="font-display font-extrabold text-[26px] tracking-tightish text-navy leading-tight">
            Zamiany zmian
          </h1>
          <p className="text-muted text-sm mt-1.5">
            Zaproponuj zamianę zmiany, potwierdź ze współpracownikiem, a manager ją zatwierdzi.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setPolling((p) => !p)}
            className="inline-flex items-center gap-2 h-9 px-3 rounded-full border border-line-strong bg-card text-[11px] font-mono uppercase tracking-[.06em] text-muted hover:bg-card-2"
            aria-pressed={polling}
          >
            <span className={`w-2 h-2 rounded-full ${polling ? 'bg-verified animate-pulse' : 'bg-muted-2'}`} />
            {polling ? 'Auto-odświeżanie · 4 s' : 'Wstrzymane'}
          </button>
          <Button className="h-10 px-3.5 text-sm" onClick={() => setProposing((v) => !v)}>
            <IconPlus className="w-[17px] h-[17px]" strokeWidth={2} />
            Zaproponuj zamianę
          </Button>
        </div>
      </div>

      {proposing && (
        <Card className="p-4 mb-4">
          <p className="text-sm text-ink">
            Wybierz swoją zmianę i zmianę współpracownika w{' '}
            <span className="font-medium">grafiku</span>, aby zaproponować zamianę. Dla dema utwórz
            przykładową propozycję:
          </p>
          <div className="flex items-center gap-2.5 mt-3">
            <Button className="h-9 px-3 text-sm" onClick={() => void propose()} disabled={busy === 'propose'}>
              Utwórz przykładową (DRAFT)
            </Button>
            <Button variant="ghost" className="h-9 px-3 text-sm" onClick={() => setProposing(false)}>
              Anuluj
            </Button>
          </div>
        </Card>
      )}

      {error && (
        <div className="mb-4 text-sm text-warn border border-warn/30 bg-warn/[0.08] rounded-lg px-3.5 py-2.5">
          {error}
        </div>
      )}

      {/* Moje prośby o zamianę */}
      <section className="mb-8">
        <h2 className="font-display font-bold text-[17px] text-navy mb-2.5">Moje prośby o zamianę</h2>
        {mine.length === 0 ? (
          <EmptyRow text="Nie masz jeszcze żadnych próśb o zamianę." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Twoja zmiana</Th>
                <Th>Zmiana współpracownika</Th>
                <Th>Status</Th>
                <Th className="text-right pr-4">Akcje</Th>
              </tr>
            </thead>
            <tbody>
              {mine.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <ShiftCell label={ownLabel(r)} sub={ownName(r)} />
                  </Td>
                  <Td>
                    {r.target ? <ShiftCell label={peerLabel(r)} sub={peerName(r)} /> : <span className="text-muted-2">— (oddanie)</span>}
                  </Td>
                  <Td>
                    <SwapBadge state={r.state} />
                  </Td>
                  <Td className="text-right pr-4">
                    <ActionButtons id={r.id} actions={mineActions(r)} busy={busy} onRun={run} />
                    {TERMINAL_STATES.includes(r.state) && mineActions(r).length === 0 && (
                      <span className="text-muted-2 text-xs">—</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      {/* Skrzynka managera */}
      <section>
        <div className="flex items-center gap-2 mb-2.5">
          <h2 className="font-display font-bold text-[17px] text-navy">Skrzynka managera — do zatwierdzenia</h2>
          <span className="inline-flex items-center gap-1 text-[11px] text-muted">
            <IconShieldCheck className="w-3.5 h-3.5 text-accent-ink" strokeWidth={1.7} />
            optymalizator sprawdza H1–H4 przy zatwierdzeniu
          </span>
        </div>
        {inbox.length === 0 ? (
          <EmptyRow text="Brak zamian oczekujących na zatwierdzenie." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Wnioskujący</Th>
                <Th>Współpracownik</Th>
                <Th>Jednostka</Th>
                <Th className="text-right pr-4">Decyzja</Th>
              </tr>
            </thead>
            <tbody>
              {inbox.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <ShiftCell label={r.requester.label} sub={r.requester.employeeName} />
                  </Td>
                  <Td>
                    {r.target ? <ShiftCell label={r.target.label} sub={r.target.employeeName} /> : <span className="text-muted-2">—</span>}
                  </Td>
                  <Td>{r.unit}</Td>
                  <Td className="text-right pr-4">
                    <div className="inline-flex items-center gap-2 justify-end">
                      <Button
                        className="h-8 px-3 text-[13px]"
                        onClick={() => void run(r.id, 'approve')}
                        disabled={busy === `${r.id}:approve`}
                      >
                        <IconCheck className="w-4 h-4" strokeWidth={2} />
                        Zatwierdź
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-8 px-3 text-[13px]"
                        onClick={() => void run(r.id, 'reject')}
                        disabled={busy === `${r.id}:reject`}
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
    </div>
  )
}

function ActionButtons({
  id,
  actions,
  busy,
  onRun,
}: {
  id: string
  actions: Array<{ act: string; label: string; variant?: 'primary' | 'ghost' }>
  busy: string | null
  onRun: (id: string, act: string) => void
}) {
  if (actions.length === 0) return null
  return (
    <div className="inline-flex items-center gap-2 justify-end">
      {actions.map((a) => (
        <Button
          key={a.act}
          variant={a.variant ?? 'primary'}
          className="h-8 px-3 text-[13px]"
          onClick={() => onRun(id, a.act)}
          disabled={busy === `${id}:${a.act}`}
        >
          {a.act === 'to-manager' && <IconArrowRight className="w-4 h-4" strokeWidth={2} />}
          {a.label}
        </Button>
      ))}
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
  return (
    <Card className="px-4 py-6 text-sm text-muted text-center">{text}</Card>
  )
}

// The caller sees their own side as "requester" or "target" depending on mineRole.
const ownLabel = (r: SwapRequest) => (r.mineRole === 'target' && r.target ? r.target.label : r.requester.label)
const ownName = (r: SwapRequest) => (r.mineRole === 'target' && r.target ? r.target.employeeName : r.requester.employeeName)
const peerLabel = (r: SwapRequest) => (r.mineRole === 'target' ? r.requester.label : r.target?.label ?? '—')
const peerName = (r: SwapRequest) => (r.mineRole === 'target' ? r.requester.employeeName : r.target?.employeeName ?? '—')
