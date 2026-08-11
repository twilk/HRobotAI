'use client'

import type { ReactNode } from 'react'
import {
  confidenceDisclosure,
  formatScore,
  retentionHeadline,
  retentionLabel,
  PEER_LEVEL_LABEL,
  slopeIndicator,
  type EmployeeCard as EmployeeCardData,
  type RetentionTone,
  type SnapshotCell,
} from '@/lib/strategic-brain'

/**
 * One employee's development card (spec §8b): the 4 measured dimensions (weighted breakdown), a
 * sparkline of the composite trajectory over the snapshot series, the confidence + disclosure note,
 * and the server-computed retention signal.
 *
 * The RODO-critical visual contract (spec §8 / §5): INWESTOWAC (weak-but-rising → an OPPORTUNITY)
 * must NOT look like RYZYKO (good-but-declining → a WARNING). They are separated on THREE axes here:
 * hue (indigo "opportunity" vs red "warning"), the trend arrow from `slopeIndicator`, and the
 * plain-Polish headline. All scoring stays server-side — this component only projects already-
 * computed backend output (retentionSignal, composite, slope, confidence) onto labels/tones.
 */

/** Semantic tone → Tailwind classes + sparkline stroke. Kept DISTINCT from the brand accent teal
 *  (spec §8: "Semantyka kolorów osobno od akcentu"). `invest` uses an indigo not present as a named
 *  design token — an "opportunity" hue deliberately unlike the red `risk` and the teal accent. */
export const RETENTION_TONE_CLASSES: Record<
  RetentionTone,
  { chip: string; stripe: string; stroke: string; fill: string }
> = {
  good: {
    chip: 'bg-verified/10 text-verified border-verified/30',
    stripe: 'bg-verified',
    stroke: '#2E9E6B',
    fill: 'rgba(46,158,107,0.14)',
  },
  watch: {
    chip: 'bg-warn/10 text-warn border-warn/30',
    stripe: 'bg-warn',
    stroke: '#B8791F',
    fill: 'rgba(184,121,31,0.14)',
  },
  risk: {
    chip: 'bg-error/10 text-error border-error/30',
    stripe: 'bg-error',
    stroke: '#C2443B',
    fill: 'rgba(194,68,59,0.14)',
  },
  invest: {
    // Indigo "opportunity" — separate hue from the red `risk` and from the teal brand accent.
    chip: 'bg-[#4B45C6]/10 text-[#4B45C6] border-[#4B45C6]/30',
    stripe: 'bg-[#4B45C6]',
    stroke: '#4B45C6',
    fill: 'rgba(75,69,198,0.14)',
  },
}

export interface DimensionWeights {
  performance: number
  timeliness: number
  quality: number
  development: number
}

export interface EmployeeCardProps {
  card: EmployeeCardData
  /** Enriched "Imię Nazwisko" via /api/employees; falls back to a short id when absent. */
  name?: string
  /** Effective scoring weights (config, HR/ADMIN only). When absent the weight badges are hidden. */
  weights?: DimensionWeights | null
}

function num(v: number | string | null): number | null {
  if (v === null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function pct(v: number | string | null): string {
  const n = num(v)
  return n === null ? '—' : `${Math.round(n * 100)}%`
}

function weightBadge(w: number | undefined): string | null {
  if (w === undefined) return null
  return `waga ${Math.round(w * 100)}%`
}

/** Minimum score span the y-axis will ever show. Below this the chart zooms no further, so a
 *  1-point wobble cannot be dramatised into a cliff. */
const MIN_DOMAIN_SPAN = 14

/**
 * Composite trajectory chart.
 *
 * THREE THINGS THIS FIXES, all visible on Andrzej Kowalczyk's card (38 · 37 · 39 · 38):
 *
 *  1. The domain was pinned to 0..100 "so cards are visually comparable". Real HR movement is
 *     small: a 2-point spread rendered as under one pixel across 44px of plot, so the chart was a
 *     flat bar — and even Rafał's genuinely alarming 86→66 collapse got nine pixels. The domain now
 *     tracks the data with a floor of {@link MIN_DOMAIN_SPAN}. Comparability is not lost, it is made
 *     EXPLICIT: the axis prints its own top and bottom, so nobody reads two cards as one scale.
 *  2. `preserveAspectRatio="none"` stretched a 240-wide viewBox across a ~410px card, so the
 *     endpoint circles rendered as visible ellipses and stroke width was horizontally squashed.
 *     Dropped — the viewBox now matches the render box and nothing is distorted.
 *  3. The area filled from a FLAT line down to the baseline, which read as a solid coloured slab
 *     rather than a chart. The fill now drops to the plot floor and, with a real domain, has shape.
 *
 * Every window gets a dot, not just the last one, so four windows read as four measurements rather
 * than a continuous curve we did not actually observe.
 */
function Sparkline({ series, tone }: { series: SnapshotCell[]; tone: RetentionTone }) {
  const pts = series
    .map((s) => num(s.compositeScore))
    .filter((v): v is number => v !== null)

  const c = RETENTION_TONE_CLASSES[tone]
  const W = 400
  const H = 78
  const padX = 30
  const padTop = 10
  const padBottom = 16

  if (pts.length < 2) {
    return <p className="text-[12px] text-muted-2">Za mało okien na wykres trajektorii.</p>
  }

  // Domain: centred on the data, at least MIN_DOMAIN_SPAN wide, clamped into 0..100.
  const lo0 = Math.min(...pts)
  const hi0 = Math.max(...pts)
  const mid = (lo0 + hi0) / 2
  const span = Math.max(hi0 - lo0, MIN_DOMAIN_SPAN)
  let lo = Math.round(Math.max(0, mid - span * 0.75))
  let hi = Math.round(Math.min(100, mid + span * 0.75))
  if (hi - lo < 4) { lo = Math.max(0, lo - 2); hi = Math.min(100, hi + 2) }

  const n = pts.length
  const x = (idx: number) => padX + (idx / (n - 1)) * (W - 2 * padX)
  const y = (v: number) => {
    const t = (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)
    return H - padBottom - t * (H - padTop - padBottom)
  }

  const coords = pts.map((v, idx) => ({ px: x(idx), py: y(v), v }))
  const linePath = coords.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${p.px.toFixed(1)},${p.py.toFixed(1)}`).join(' ')
  const floor = H - padBottom
  const areaPath = `${linePath} L${coords[n - 1]!.px.toFixed(1)},${floor} L${coords[0]!.px.toFixed(1)},${floor} Z`
  const last = coords[n - 1]!

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-[78px] w-full"
      role="img"
      aria-label={`Trajektoria wyniku ogólnego: ${pts.map((v) => Math.round(v)).join(', ')} w kolejnych oknach`}
    >
      {/* plot frame: top and bottom of the visible range, labelled so the zoom is never implicit */}
      <line x1={padX} y1={padTop} x2={W - padX} y2={padTop} stroke="currentColor" className="text-line" strokeWidth={1} />
      <line x1={padX} y1={floor} x2={W - padX} y2={floor} stroke="currentColor" className="text-line" strokeWidth={1} />
      <text x={padX - 6} y={padTop + 3} textAnchor="end" className="fill-current text-muted-2" fontSize={9}>
        {hi}
      </text>
      <text x={padX - 6} y={floor + 3} textAnchor="end" className="fill-current text-muted-2" fontSize={9}>
        {lo}
      </text>

      <path d={areaPath} fill={c.fill} stroke="none" />
      <path d={linePath} fill="none" stroke={c.stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

      {/* one dot per observed window — four measurements, not a continuous curve */}
      {coords.slice(0, -1).map((p, idx) => (
        <circle key={idx} cx={p.px} cy={p.py} r={2.6} fill="#fff" stroke={c.stroke} strokeWidth={1.5} />
      ))}
      <circle cx={last.px} cy={last.py} r={6.5} fill={c.stroke} fillOpacity={0.16} />
      <circle cx={last.px} cy={last.py} r={3.6} fill={c.stroke} />
    </svg>
  )
}

/**
 * The trajectory's numbers, as a caption under the chart rather than labels inside it.
 *
 * They started life as SVG `<text>` at the two ends, which put the first value directly under the
 * axis's own low-range label — "28" and "38" landed within a few pixels of each other in the
 * bottom-left corner and read as one garbled number. Outside the plot there is room to state the
 * whole thing in words, and it stays legible when the card narrows.
 */
function TrajectoryCaption({ series }: { series: SnapshotCell[] }) {
  const pts = series.map((s) => num(s.compositeScore)).filter((v): v is number => v !== null)
  if (pts.length < 2) return null
  const first = Math.round(pts[0]!)
  const last = Math.round(pts[pts.length - 1]!)
  const delta = last - first
  return (
    <p className="mt-0.5 text-[11px] text-muted-2 tabular-nums">
      {first} → {last} w {pts.length} oknach
      {delta !== 0 && ` (${delta > 0 ? '+' : ''}${delta} pkt)`}
    </p>
  )
}

function DimensionRow({ label, value, weight }: { label: string; value: ReactNode; weight: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1.5">
      <span className="text-[13px] text-muted">
        {label}
        {weight && <span className="ml-1.5 text-[11px] text-muted-2">· {weight}</span>}
      </span>
      <span className="text-[13.5px] font-semibold text-navy tabular-nums">{value}</span>
    </div>
  )
}

export function EmployeeCard({ card, name, weights }: EmployeeCardProps) {
  const f = card.factors
  const signal = card.retentionSignal
  const tone: RetentionTone = signal ? retentionLabel(signal).tone : 'watch'
  const c = RETENTION_TONE_CLASSES[tone]
  const displayName = name ?? `#${card.employeeId.slice(0, 8)}`

  const slope = f ? f.developmentSlope : null
  const trend = slopeIndicator(slope)
  const disclosure = f ? confidenceDisclosure(f.confidence) : null

  return (
    <div className="relative overflow-hidden rounded-lg border border-line bg-card shadow-sm">
      {/* left tone stripe — the first, pre-attentive INWESTOWAC≠RYZYKO cue */}
      <div className={'absolute inset-y-0 left-0 w-1 ' + c.stripe} aria-hidden />
      <div className="p-4 pl-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold text-navy">{displayName}</h3>
            {f?.isNewHire && (
              <span className="mt-0.5 inline-block text-[11px] text-muted-2">nowo zatrudniony/a</span>
            )}
          </div>
          {signal ? (
            <span
              className={'inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold ' + c.chip}
            >
              <span aria-hidden className="text-[12px] leading-none">{trend.arrow}</span>
              {retentionLabel(signal).label}
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center rounded-full border border-line bg-card-2 px-2.5 py-1 text-[11.5px] font-medium text-muted-2">
              Zbiera dane
            </span>
          )}
        </div>

        {signal && (
          <p className="mt-2 text-[12.5px] leading-snug text-muted">{retentionHeadline(signal, slope)}</p>
        )}

        {/* composite score + confidence */}
        <div className="mt-3 flex items-end gap-3">
          <div className="font-display text-[30px] font-extrabold leading-none tabular-nums text-navy">
            {formatScore(f ? f.compositeScore : null)}
          </div>
          <div className="pb-0.5 text-[11.5px] text-muted-2">
            <div>wynik ogólny (0–100)</div>
            <div className="tabular-nums">pewność {f ? `${Math.round(f.confidence * 100)}%` : '—'}</div>
          </div>
        </div>
        {disclosure && (
          <p className="mt-1.5 rounded-sm bg-warn/[0.08] px-2 py-1 text-[11.5px] text-warn">{disclosure}</p>
        )}

        {/* sparkline */}
        <div className="mt-3">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-2">Trajektoria</div>
          <Sparkline series={card.series} tone={tone} />
          <TrajectoryCaption series={card.series} />
        </div>

        {/* 4-dimension breakdown */}
        <div className="mt-2 divide-y divide-line border-t border-line pt-1">
          <DimensionRow
            label="Wydajność"
            // The percentile, NOT `throughput`. This row sits next to "waga 30%", and 30% is applied
            // to the peer-normalized value — printing the raw order count here described a model the
            // engine does not use. The count follows in muted text as the fact behind the ranking.
            value={
              f && f.performancePercentile != null ? (
                <span
                  title={
                    f.peerMeaningful === false
                      ? `Pozycja wśród ${f.peerGroupSize ?? '?'} os. — grupa zbyt mała, wartość orientacyjna.`
                      : `Pozycja wśród ${f.peerGroupSize ?? '?'} os. — porównanie: ${
                          f.peerLevel ? PEER_LEVEL_LABEL[f.peerLevel] : 'grupa porównawcza'
                        }.`
                  }
                >
                  {f.peerMeaningful === false ? '~' : ''}
                  {Math.round(f.performancePercentile)}
                  <span className="ml-1.5 text-[11px] font-normal text-muted-2">
                    / 100 · {f.throughput} zleceń
                  </span>
                </span>
              ) : f ? (
                <span>
                  —
                  <span className="ml-1.5 text-[11px] font-normal text-muted-2">{f.throughput} zleceń</span>
                </span>
              ) : (
                '—'
              )
            }
            weight={weightBadge(weights?.performance)}
          />
          <DimensionRow
            label="Terminowość"
            value={pct(f ? f.slaHitRate : null)}
            weight={weightBadge(weights?.timeliness)}
          />
          <DimensionRow
            label="Jakość"
            value={f && f.defectRate !== null ? `${Math.round(f.defectRate * 100)}% wad` : '—'}
            weight={weightBadge(weights?.quality)}
          />
          <DimensionRow
            label="Rozwój"
            value={
              <span className={tone === 'invest' ? 'text-[#4B45C6]' : tone === 'risk' ? 'text-error' : ''}>
                {trend.arrow} {slope === null ? '—' : slope.toFixed(2)}
              </span>
            }
            weight={weightBadge(weights?.development)}
          />
        </div>
      </div>
    </div>
  )
}
