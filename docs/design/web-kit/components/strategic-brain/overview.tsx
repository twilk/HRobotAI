'use client'

import { useEffect, useRef, useState } from 'react'
import { EmployeeCard, RETENTION_TONE_CLASSES, type DimensionWeights } from '@/components/strategic-brain/employee-card'
import { RecruitmentPanel } from '@/components/strategic-brain/recruitment-panel'
import { IconSparkles, IconUsers } from '@/components/icons'
import {
  strategicBrainApi,
  retentionLabel,
  slopeIndicator,
  formatScore,
  type EmployeeCard as EmployeeCardData,
  type Overview,
  type RetentionSignal,
  type SnapshotCell,
} from '@/lib/strategic-brain'

/**
 * HR/ADMIN (global) and MANAGER (unit-scoped) overview (spec §8a): a scannable heatmap of every
 * in-scope employee across the 4 dimensions + a proactive feed (retention + recruitment) with the
 * backend's rationale. Scoping is enforced server-side (M16) — this component just renders whatever
 * the scope-filtered `/overview` returns.
 *
 * The heatmap's authoritative retention signal per row comes from each employee's CARD
 * (`retentionSignal` is computed server-side and only lives on the card, never on a heat cell), so
 * we enrich rows by fetching cards — NEVER by re-deriving the signal client-side (RODO §7).
 */

interface ApiEmployeeName {
  id: string
  firstName: string
  lastName: string
}

function num(v: number | string | null): number | null {
  if (v === null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function pctText(v: number | string | null): string {
  const n = num(v)
  return n === null ? '—' : `${Math.round(n * 100)}%`
}

/** DISPLAY-only directional tint for a heat cell (aids scanning) — NOT the retention decision, which
 *  stays server-side. Green when clearly good, amber when clearly weak, else neutral. */
function slaTone(v: number | string | null): string {
  const n = num(v)
  if (n === null) return 'text-muted-2'
  if (n >= 0.9) return 'text-verified'
  if (n < 0.75) return 'text-warn'
  return 'text-navy'
}
function defectTone(v: number | string | null): string {
  const n = num(v)
  if (n === null) return 'text-muted-2'
  if (n <= 0.05) return 'text-verified'
  if (n > 0.12) return 'text-warn'
  return 'text-navy'
}

const FEED_REASON: Record<'RYZYKO' | 'INWESTOWAC', string> = {
  RYZYKO: 'Dobry wynik, ale trend spadkowy — ryzyko odejścia.',
  INWESTOWAC: 'Słabszy wynik, ale rośnie — warto zainwestować.',
}

export interface StrategicOverviewProps {
  /** 'global' = HR/ADMIN (may read config + acknowledge); 'manager' = unit-scoped, read-only. */
  scope: 'global' | 'manager'
}

export function StrategicOverview({ scope }: StrategicOverviewProps) {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [cards, setCards] = useState<Map<string, EmployeeCardData>>(new Map())
  const [weights, setWeights] = useState<DimensionWeights | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    void (async () => {
      try {
        const [ov, employees] = await Promise.all([
          strategicBrainApi.getOverview(),
          fetch('/api/employees', { cache: 'no-store' })
            .then((r) => (r.ok ? (r.json() as Promise<ApiEmployeeName[]>) : []))
            .catch(() => [] as ApiEmployeeName[]),
        ])
        if (cancelledRef.current) return
        setOverview(ov)
        setNames(new Map(employees.map((e) => [e.id, `${e.firstName} ${e.lastName}`])))
        setLoading(false)

        // Enrich rows with the server-computed retention signal by loading each card.
        const results = await Promise.allSettled(ov.heatmap.map((h) => strategicBrainApi.getEmployeeCard(h.employeeId)))
        if (cancelledRef.current) return
        const map = new Map<string, EmployeeCardData>()
        for (const r of results) if (r.status === 'fulfilled') map.set(r.value.employeeId, r.value)
        setCards(map)
      } catch (e) {
        if (!cancelledRef.current) {
          setError(e instanceof Error ? e.message : 'Nie udało się wczytać analizy.')
          setLoading(false)
        }
      }

      // Weights (config) — HR/ADMIN only; best-effort, a MANAGER 403 just hides weight badges.
      if (scope === 'global') {
        try {
          const cfg = await strategicBrainApi.getConfig()
          if (!cancelledRef.current) {
            setWeights({
              performance: Number(cfg.weightPerformance),
              timeliness: Number(cfg.weightTimeliness),
              quality: Number(cfg.weightQuality),
              development: Number(cfg.weightDevelopment),
            })
          }
        } catch {
          /* config not readable — leave weights null */
        }
      }
    })()
    return () => {
      cancelledRef.current = true
    }
  }, [scope])

  const nameOf = (id: string) => names.get(id) ?? `#${id.slice(0, 8)}`

  if (loading) return <p className="text-sm text-muted">Ładowanie analizy…</p>
  if (error) return <p className="text-sm text-error">{error}</p>
  if (!overview) return null

  const rows = overview.heatmap
  const retentionFeed = [...cards.values()]
    .filter((c) => c.retentionSignal === 'RYZYKO' || c.retentionSignal === 'INWESTOWAC')
    .sort((a, b) => (a.retentionSignal === 'RYZYKO' ? -1 : 1) - (b.retentionSignal === 'RYZYKO' ? -1 : 1))

  const selectedCard = selectedId ? cards.get(selectedId) : null

  return (
    <div className="space-y-6">
      {/* Retention feed — proactive, per-employee */}
      {retentionFeed.length > 0 && (
        <section>
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-tightish text-navy">
            <IconSparkles className="h-[17px] w-[17px] text-accent-ink" strokeWidth={1.7} />
            Sygnały retencji
          </h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {retentionFeed.map((c) => {
              const sig = c.retentionSignal as 'RYZYKO' | 'INWESTOWAC'
              const t = retentionLabel(sig)
              const tc = RETENTION_TONE_CLASSES[t.tone]
              return (
                <button
                  key={c.employeeId}
                  onClick={() => setSelectedId(c.employeeId)}
                  className="relative flex items-start gap-3 overflow-hidden rounded-md border border-line bg-card p-3 pl-4 text-left transition-colors hover:bg-card-2"
                >
                  <span className={'absolute inset-y-0 left-0 w-1 ' + tc.stripe} aria-hidden />
                  <span className={'mt-0.5 inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ' + tc.chip}>
                    {t.label}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-semibold text-navy">{nameOf(c.employeeId)}</span>
                    <span className="block text-[12px] text-muted">{FEED_REASON[sig]}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* Heatmap */}
      <section>
        <h2 className="flex items-center gap-2 text-base font-semibold tracking-tightish text-navy">
          <IconUsers className="h-[17px] w-[17px] text-accent-ink" strokeWidth={1.7} />
          Mapa wydajności i rozwoju
          <span className="ml-1 text-[12px] font-normal text-muted-2 tabular-nums">{rows.length} os.</span>
        </h2>
        {rows.length === 0 ? (
          <p className="mt-3 rounded-md border border-line bg-card-2 px-4 py-3 text-[13px] text-muted">
            Brak danych w Twoim zakresie — analiza zbierze je wraz z kolejnymi oknami.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-card">
            <table className="w-full min-w-[640px] text-left">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted-2">
                  <th className="px-3 py-2 font-medium">Pracownik</th>
                  <th className="px-3 py-2 text-right font-medium">Wydajność</th>
                  <th className="px-3 py-2 text-right font-medium">Terminowość</th>
                  <th className="px-3 py-2 text-right font-medium">Jakość</th>
                  <th className="px-3 py-2 text-right font-medium">Rozwój</th>
                  <th className="px-3 py-2 text-right font-medium">Wynik</th>
                  <th className="px-3 py-2 font-medium">Sygnał</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((cell: SnapshotCell) => {
                  const card = cards.get(cell.employeeId)
                  const sig: RetentionSignal | null = card?.retentionSignal ?? null
                  const trend = slopeIndicator(num(cell.developmentSlope))
                  const isSel = selectedId === cell.employeeId
                  return (
                    <tr
                      key={cell.employeeId}
                      onClick={() => setSelectedId(isSel ? null : cell.employeeId)}
                      className={'cursor-pointer text-[13px] transition-colors hover:bg-card-2 ' + (isSel ? 'bg-accent/[0.05]' : '')}
                    >
                      <td className="px-3 py-2 font-medium text-navy">{nameOf(cell.employeeId)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-navy">{cell.throughput}</td>
                      <td className={'px-3 py-2 text-right tabular-nums ' + slaTone(cell.slaHitRate)}>{pctText(cell.slaHitRate)}</td>
                      <td className={'px-3 py-2 text-right tabular-nums ' + defectTone(cell.defectRate)}>{pctText(cell.defectRate)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-navy">
                        <span aria-hidden>{trend.arrow}</span>{' '}
                        {num(cell.developmentSlope) === null ? '—' : num(cell.developmentSlope)!.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-navy">{formatScore(num(cell.compositeScore))}</td>
                      <td className="px-3 py-2">
                        {sig ? (
                          <span className={'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ' + RETENTION_TONE_CLASSES[retentionLabel(sig).tone].chip}>
                            {retentionLabel(sig).label}
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted-2">…</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Selected employee card */}
        {selectedCard && (
          <div className="mt-4 max-w-md">
            <EmployeeCard card={selectedCard} name={nameOf(selectedCard.employeeId)} weights={weights} />
          </div>
        )}
      </section>

      {/* Recruitment feed */}
      <RecruitmentPanel recommendations={overview.recruitment} canAcknowledge={scope === 'global'} />
    </div>
  )
}
