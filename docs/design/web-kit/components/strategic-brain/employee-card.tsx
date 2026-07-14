'use client'

import type { ReactNode } from 'react'
import {
  confidenceDisclosure,
  formatScore,
  retentionLabel,
  slopeIndicator,
  type EmployeeCard as EmployeeCardData,
  type RetentionSignal,
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

/** The retention signal → a one-line plain-Polish "why", the level-vs-trend distinction the spec
 *  calls the core of the model. Copy only — never a re-derivation of the signal itself. */
const SIGNAL_HEADLINE: Record<RetentionSignal, string> = {
  UTRZYMAC: 'Stabilnie mocny — utrzymać zaangażowanie.',
  INWESTOWAC: 'Słabszy wynik, ale rośnie — warto zainwestować w rozwój.',
  RYZYKO: 'Dobry wynik, ale spada — ryzyko odejścia, zareaguj wcześnie.',
  OBSERWOWAC: 'Sygnały mieszane — obserwuj, zbieraj więcej danych.',
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

/** Composite trajectory sparkline: line + area, an emphasized endpoint, and a faint baseline at the
 *  first window's score so rise/decline reads at a glance. Pure SVG, tone-colored. Domain fixed to
 *  0..100 (scores are always whole 0..100) so cards are visually comparable. */
function Sparkline({ series, tone }: { series: SnapshotCell[]; tone: RetentionTone }) {
  const pts = series
    .map((s) => num(s.compositeScore))
    .map((v, i) => ({ i, v }))
    .filter((p): p is { i: number; v: number } => p.v !== null)

  const c = RETENTION_TONE_CLASSES[tone]
  const W = 240
  const H = 60
  const padX = 6
  const padY = 8

  if (pts.length < 2) {
    return <p className="text-[12px] text-muted-2">Za mało okien na wykres trajektorii.</p>
  }

  const n = pts.length
  const x = (idx: number) => padX + (idx / (n - 1)) * (W - 2 * padX)
  const y = (v: number) => {
    const clamped = Math.max(0, Math.min(100, v))
    return H - padY - (clamped / 100) * (H - 2 * padY)
  }

  const coords = pts.map((p, idx) => ({ px: x(idx), py: y(p.v) }))
  const linePath = coords.map((p, idx) => `${idx === 0 ? 'M' : 'L'}${p.px.toFixed(1)},${p.py.toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${coords[coords.length - 1].px.toFixed(1)},${(H - padY).toFixed(1)} L${coords[0].px.toFixed(1)},${(H - padY).toFixed(1)} Z`
  const last = coords[coords.length - 1]
  const baselineY = y(pts[0].v)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-[60px]"
      role="img"
      aria-label="Trajektoria wyniku ogólnego w kolejnych oknach"
      preserveAspectRatio="none"
    >
      {/* faint baseline at the starting score */}
      <line
        x1={padX}
        y1={baselineY}
        x2={W - padX}
        y2={baselineY}
        stroke={c.stroke}
        strokeOpacity={0.18}
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <path d={areaPath} fill={c.fill} stroke="none" />
      <path d={linePath} fill="none" stroke={c.stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {/* emphasized endpoint: halo + solid dot */}
      <circle cx={last.px} cy={last.py} r={6} fill={c.stroke} fillOpacity={0.18} />
      <circle cx={last.px} cy={last.py} r={3.4} fill={c.stroke} />
    </svg>
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
          <p className="mt-2 text-[12.5px] leading-snug text-muted">{SIGNAL_HEADLINE[signal]}</p>
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
        </div>

        {/* 4-dimension breakdown */}
        <div className="mt-2 divide-y divide-line border-t border-line pt-1">
          <DimensionRow
            label="Wydajność"
            value={f ? `${f.throughput}` : '—'}
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
