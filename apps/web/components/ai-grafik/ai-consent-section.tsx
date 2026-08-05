'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, Th, Td } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { IconCheck, IconClose } from '@/components/icons'
import {
  aiProposalApi,
  fetchMyEmployeeId,
  aiProposalActions,
  proposalStateLabel,
  isMineToConsent,
  buildProposalEnrichMaps,
  enrichProposalsWith,
  myTravelText,
  AiGrafikApiError,
  type EnrichedProposal,
  type AiProposalState,
} from '@/lib/ai-grafik'

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
 * proposal-inbox.tsx's actionErrorMessage.
 */
function actionErrorMessage(err: unknown): string {
  if (err instanceof AiGrafikApiError) return err.message || 'Coś poszło nie tak. Spróbuj ponownie.'
  return 'Brak połączenia z serwerem. Spróbuj ponownie.'
}

/**
 * The caller's own pending AI replacement-consent request(s), if any (Task 1.5 / SP0 relocation). This
 * used to be Section B of components/ai-grafik/proposal-inbox.tsx; it now lives on /zamiany (the
 * PRACOWNIK-visible "a shift change is proposed to you" page) since /ai-grafik-manager is manager-only
 * again. Visible to EVERY logged-in role — a plain PRACOWNIK is exactly who this is for.
 *
 * Mirrors proposal-inbox.tsx's polling/enrichment: ~4s poll, fetchMyEmployeeId + listProposalsRaw({mine:
 * true}) + a single buildProposalEnrichMaps/enrichProposalsWith pass + isMineToConsent filter. The
 * backend never returns employee names (ids only) — enrichment is always client-side. NEVER display
 * PESEL/home — this screen has no employee/PESEL concept at all, only shift + state.
 */
export function AiConsentSection() {
  const [myConsent, setMyConsent] = useState<EnrichedProposal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())

  // Tied to the component's lifetime: a poll tick (or the mount fetch) can resolve after unmount.
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

      const mineRaw = await aiProposalApi.listProposalsRaw({ mine: true })
      if (cancelledRef.current) return

      const maps = await buildProposalEnrichMaps()
      if (cancelledRef.current) return

      const mine = enrichProposalsWith(mineRaw, maps)
      setMyConsent(mine.filter((p) => isMineToConsent(p, meId)))
      setError(null)
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
    timer.current = setInterval(() => void refresh(), POLL_MS)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [refresh])

  const run = useCallback(
    async (id: string, accept: boolean) => {
      const key = `${id}:${accept ? 'accept' : 'decline'}`
      setBusy((prev) => new Set(prev).add(key))
      setError(null)
      try {
        await aiProposalApi.consent(id, accept)
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

  if (loading) return <div className="grid place-items-center py-10 text-muted text-sm">Ładowanie…</div>

  return (
    <section className="mb-8">
      <h2 className="font-display font-bold text-[17px] text-navy mb-2.5">
        Propozycje AI — zastępstwo wymaga Twojej zgody
      </h2>

      {error && (
        <div
          role="alert"
          className="mb-4 text-sm text-warn border border-warn/30 bg-warn/[0.08] rounded-lg px-3.5 py-2.5"
        >
          {error}
        </div>
      )}

      {myConsent.length === 0 ? (
        <EmptyRow text="Brak propozycji zmian wymagających Twojej zgody." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Zmiana do objęcia</Th>
              <Th>Lokalizacja i dojazd</Th>
              <Th>Status</Th>
              <Th className="text-right pr-4">Twoja decyzja</Th>
            </tr>
          </thead>
          <tbody>
            {myConsent.map((p) => {
              const actions = aiProposalActions(p.state, 'employee')
              // The consent screen is only ever reached by the ACTIVE candidate (isMineToConsent), so
              // this is always "my" travel row — show shift + location + estimated travel BEFORE the
              // decision, so the employee can judge the ask before Akceptuj/Odrzuć (2026-07-14 spec
              // §12 Etap 3). RODO: only rounded km/min ever leaves the server — no coordinates/address.
              const active = p.candidates.find((c) => c.id === p.activeCandidateId)
              const travel = active ? myTravelText(active) : null
              return (
                <tr key={p.id}>
                  <Td>
                    <ShiftCell label={p.shiftLabel} sub={p.reason ?? 'Propozycja AI'} />
                  </Td>
                  <Td>
                    <div className="text-[13px]">{p.shiftLocation || '—'}</div>
                    <div className="text-[11.5px] text-muted-2 mt-0.5">
                      {travel ?? 'Ta sama jednostka — bez dojazdu'}
                    </div>
                  </Td>
                  <Td>
                    <ProposalBadge state={p.state} />
                  </Td>
                  <Td className="text-right pr-4">
                    <div className="inline-flex items-center gap-2 justify-end">
                      {actions.map((a) => (
                        <Button
                          key={a.action}
                          variant={a.action === 'decline' ? 'ghost' : 'primary'}
                          className="h-8 px-3 text-[13px]"
                          onClick={() => void run(p.id, a.action === 'accept')}
                          disabled={busy.has(`${p.id}:${a.action}`)}
                        >
                          {a.action === 'accept' && <IconCheck className="w-4 h-4" strokeWidth={2} />}
                          {a.action === 'decline' && <IconClose className="w-4 h-4" strokeWidth={2} />}
                          {a.label}
                        </Button>
                      ))}
                    </div>
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
    </section>
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
