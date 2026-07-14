'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { IconCheck, IconShieldCheck } from '@/components/icons'
import { locationName, unitName } from '@/lib/demo-locations'
import {
  strategicBrainApi,
  verdictLabel,
  type RecruitmentRecommendation,
  type RecruitmentVerdict,
} from '@/lib/strategic-brain'

/**
 * Per-scope recruitment recommendations (spec §8c): WZNOW / WSTRZYMAJ / UTRZYMAJ with the backend's
 * own rationale, and — for HR/ADMIN only — a "Zaakceptuj rekomendację" action.
 *
 * CRITICAL (RODO art. 22, M13/M19): acknowledging LOGS a human decision on the recommendation; it
 * NEVER hires or fires anyone. The copy makes that explicit, and the button is hidden for a scoped
 * MANAGER (the backend `acknowledge` route is HR/ADMIN-only).
 */

const VERDICT_TONE: Record<RecruitmentVerdict, { chip: string; stripe: string }> = {
  // Resume hiring — a growth signal (green "good").
  WZNOW: { chip: 'bg-verified/10 text-verified border-verified/30', stripe: 'bg-verified' },
  // Pause hiring — a caution signal (amber "warn"), NOT an alarm: it's a spend-control recommendation.
  WSTRZYMAJ: { chip: 'bg-warn/10 text-warn border-warn/30', stripe: 'bg-warn' },
  // Hold / no change — neutral.
  UTRZYMAJ: { chip: 'bg-card-2 text-muted-2 border-line', stripe: 'bg-line-strong' },
}

function scopeName(rec: RecruitmentRecommendation): string {
  return rec.scopeType === 'LOKALIZACJA' ? locationName(rec.scopeId) : unitName(rec.scopeId)
}

function scopeKindLabel(rec: RecruitmentRecommendation): string {
  return rec.scopeType === 'LOKALIZACJA' ? 'Lokalizacja' : 'Jednostka'
}

function RecommendationRow({
  rec,
  canAcknowledge,
  onAcknowledged,
}: {
  rec: RecruitmentRecommendation
  canAcknowledge: boolean
  onAcknowledged: (updated: RecruitmentRecommendation) => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tone = VERDICT_TONE[rec.verdict]
  const acknowledged = rec.acknowledgedAt !== null

  async function acknowledge() {
    setPending(true)
    setError(null)
    try {
      const updated = await strategicBrainApi.acknowledgeRecruitment(rec.id)
      onAcknowledged(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się zapisać decyzji.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="relative overflow-hidden rounded-md border border-line bg-card">
      <div className={'absolute inset-y-0 left-0 w-1 ' + tone.stripe} aria-hidden />
      <div className="p-4 pl-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={'inline-flex items-center rounded-full border px-2.5 py-1 text-[11.5px] font-semibold ' + tone.chip}>
            {verdictLabel(rec.verdict)}
          </span>
          <span className="text-[13.5px] font-semibold text-navy">{scopeName(rec)}</span>
          <span className="text-[11.5px] text-muted-2">{scopeKindLabel(rec)}</span>
        </div>

        <p className="mt-2 text-[13px] leading-snug text-muted">{rec.rationale}</p>

        <div className="mt-3 flex items-center justify-between gap-3">
          {acknowledged ? (
            <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-verified">
              <IconCheck className="h-[15px] w-[15px]" strokeWidth={2} />
              Decyzja zapisana
            </span>
          ) : canAcknowledge ? (
            <Button
              variant="ghost"
              className="h-[34px] px-3 text-[13px]"
              onClick={acknowledge}
              disabled={pending}
            >
              {pending ? 'Zapisywanie…' : 'Zaakceptuj rekomendację'}
            </Button>
          ) : (
            <span className="text-[11.5px] text-muted-2">Akceptacja: HR / Admin</span>
          )}
          <span className="text-[11px] text-muted-2">Rejestruje decyzję — nie wykonuje działań kadrowych</span>
        </div>
        {error && <p className="mt-2 text-[12px] text-error">{error}</p>}
      </div>
    </div>
  )
}

export interface RecruitmentPanelProps {
  recommendations: RecruitmentRecommendation[]
  /** HR/ADMIN — the only roles the backend `acknowledge` route permits. */
  canAcknowledge: boolean
}

export function RecruitmentPanel({ recommendations, canAcknowledge }: RecruitmentPanelProps) {
  const [items, setItems] = useState(recommendations)

  function handleAcknowledged(updated: RecruitmentRecommendation) {
    setItems((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
  }

  return (
    <section>
      <h2 className="flex items-center gap-2 text-base font-semibold tracking-tightish text-navy">
        <IconShieldCheck className="h-[17px] w-[17px] text-accent-ink" strokeWidth={1.7} />
        Rekomendacje rekrutacji
      </h2>
      <p className="mt-1 text-[12.5px] text-muted">
        Autonomiczne, wyjaśnialne rekomendacje per lokalizacja — akceptacja wyłącznie rejestruje
        decyzję człowieka (art. 22 RODO).
      </p>

      {items.length === 0 ? (
        <p className="mt-3 rounded-md border border-line bg-card-2 px-4 py-3 text-[13px] text-muted">
          Brak aktywnych rekomendacji rekrutacji w Twoim zakresie.
        </p>
      ) : (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {items.map((rec) => (
            <RecommendationRow
              key={rec.id}
              rec={rec}
              canAcknowledge={canAcknowledge}
              onAcknowledged={handleAcknowledged}
            />
          ))}
        </div>
      )}
    </section>
  )
}
