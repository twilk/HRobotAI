/**
 * Chart primitives for the Analityk HR screen — plain SVG + CSS, NO charting library.
 *
 * The web-kit ships no chart dependency (see package.json: next, react, clsx, tailwind-merge), and
 * this module deliberately adds none. Every shape is drawn from the pure geometry helpers in
 * lib/analityk.ts (`barHeights`, `linePoints`, `xPositions`, `stackOffsets`), which are unit-tested
 * separately, so the components stay declarative and the maths stays verifiable.
 *
 * Colours come only from the design tokens in tailwind.config.ts. Every chart is given a `<title>`
 * for screen readers and renders a plain-language empty state instead of an empty axis.
 */

import { barHeights, chartMax, linePoints, stackOffsets, xPositions } from '@/lib/analityk'

/** Palette for categorical series — semantic tones stay reserved for good/bad readings. */
const SERIES_FILL = ['fill-accent', 'fill-navy-700', 'fill-accent-navy', 'fill-muted', 'fill-line-strong']
const SERIES_BG = ['bg-accent', 'bg-navy-700', 'bg-accent-navy', 'bg-muted', 'bg-line-strong']

function EmptyChart({ label }: { label: string }) {
  return (
    <p className="rounded-md border border-dashed border-line bg-card-2 px-3 py-6 text-center text-[12.5px] text-muted-2">
      {label}
    </p>
  )
}

export interface BarDatum {
  label: string
  value: number
  /** Optional right-hand caption (e.g. a percentage) shown next to the value. */
  hint?: string
}

/**
 * Horizontal bar chart — the default for named categories (units, leave types, locations), because a
 * horizontal bar gives a long Polish unit name room to breathe without rotating the labels.
 */
export function BarChart({
  data,
  emptyLabel = 'Brak danych w tym zakresie.',
  valueFormat = (v: number) => String(v),
  barClass = 'bg-accent',
}: {
  data: BarDatum[]
  emptyLabel?: string
  valueFormat?: (value: number) => string
  barClass?: string
}) {
  if (data.length === 0) return <EmptyChart label={emptyLabel} />
  const max = chartMax(data.map((d) => d.value))

  return (
    <ul className="space-y-2">
      {data.map((d) => {
        const pct = Math.max(1, Math.round((Math.max(0, d.value) / max) * 100))
        return (
          <li key={d.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
            <span className="truncate text-[13px] text-navy" title={d.label}>
              {d.label}
            </span>
            <span className="text-right text-[13px] font-semibold tabular-nums text-navy">
              {valueFormat(d.value)}
              {d.hint ? <span className="ml-1.5 font-normal text-muted-2">{d.hint}</span> : null}
            </span>
            <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-line/70">
              <span className={`block h-full rounded-full ${barClass}`} style={{ width: `${pct}%` }} />
            </span>
          </li>
        )
      })}
    </ul>
  )
}

export interface SeriesDatum {
  label: string
  values: number[]
}

/**
 * Grouped vertical column chart for a short time series (the monthly hire/departure dynamics).
 * Drawn as SVG so the columns scale with the container while the labels stay crisp.
 */
export function ColumnChart({
  categories,
  series,
  emptyLabel = 'Brak danych w tym zakresie.',
  height = 120,
}: {
  categories: string[]
  series: SeriesDatum[]
  emptyLabel?: string
  height?: number
}) {
  if (categories.length === 0 || series.length === 0) return <EmptyChart label={emptyLabel} />

  const all = series.flatMap((s) => s.values)
  const max = chartMax(all)
  const groupWidth = 100 / categories.length
  const barWidth = (groupWidth * 0.62) / series.length

  return (
    <div>
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="h-[120px] w-full"
        role="img"
        aria-label={`Wykres kolumnowy: ${series.map((s) => s.label).join(', ')}`}
      >
        <title>{`Wykres kolumnowy: ${series.map((s) => s.label).join(', ')}`}</title>
        <line x1="0" y1={height} x2="100" y2={height} className="stroke-line" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
        {categories.map((cat, ci) => {
          const groupStart = ci * groupWidth + groupWidth * 0.19
          return series.map((s, si) => {
            const value = s.values[ci] ?? 0
            const h = value > 0 ? Math.max(2, (value / max) * (height - 6)) : 1
            return (
              <rect
                key={`${cat}-${s.label}`}
                x={groupStart + si * barWidth}
                y={height - h}
                width={barWidth * 0.86}
                height={h}
                rx="0.6"
                className={SERIES_FILL[si % SERIES_FILL.length]}
              />
            )
          })
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-muted-2">
        {categories.map((c) => (
          <span key={c} className="truncate">
            {c}
          </span>
        ))}
      </div>
      <ChartLegend items={series.map((s) => s.label)} />
    </div>
  )
}

/** Shared legend so every chart labels its series the same way. */
export function ChartLegend({ items }: { items: string[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
      {items.map((label, i) => (
        <li key={label} className="flex items-center gap-1.5 text-[11.5px] text-muted">
          <span className={`h-2 w-2 shrink-0 rounded-[2px] ${SERIES_BG[i % SERIES_BG.length]}`} aria-hidden />
          {label}
        </li>
      ))}
    </ul>
  )
}

/**
 * Sparkline for a single series — used for the leave-balance distribution, where the shape of the
 * curve says more than the individual bucket counts.
 */
export function Sparkline({ values, label, height = 44 }: { values: number[]; label: string; height?: number }) {
  if (values.length === 0) return <EmptyChart label="Brak danych." />
  const width = 100
  const points = linePoints(values, width, height)
  const xs = xPositions(values.length, width)
  const max = chartMax(values)

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-11 w-full" role="img" aria-label={label}>
      <title>{label}</title>
      <polyline points={points} className="fill-none stroke-accent" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      {values.map((v, i) => {
        const safe = Number.isFinite(v) && v > 0 ? v : 0
        return (
          <circle
            key={i}
            cx={xs[i]}
            cy={height - (safe / max) * height}
            r="1.4"
            className="fill-accent-ink"
            vectorEffect="non-scaling-stroke"
          />
        )
      })}
    </svg>
  )
}

export interface StackSegment {
  label: string
  value: number
}

/**
 * 100%-stacked bar for a composition (leave types, request outcomes). Renders the share of each
 * segment; a zero total collapses to the empty state rather than a misleading full-width block.
 */
export function StackedBar({ segments, emptyLabel = 'Brak danych.' }: { segments: StackSegment[]; emptyLabel?: string }) {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0)
  if (segments.length === 0 || total <= 0) return <EmptyChart label={emptyLabel} />
  const parts = stackOffsets(segments.map((s) => s.value))

  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-line/70" role="img" aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(', ')}>
        {parts.map((p, i) => (
          <span
            key={segments[i]?.label ?? i}
            className={SERIES_BG[i % SERIES_BG.length]}
            style={{ width: `${p.width}%` }}
            title={`${segments[i]?.label}: ${segments[i]?.value}`}
          />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((s, i) => (
          <li key={s.label} className="flex items-center gap-1.5 text-[11.5px] text-muted">
            <span className={`h-2 w-2 shrink-0 rounded-[2px] ${SERIES_BG[i % SERIES_BG.length]}`} aria-hidden />
            {s.label}
            <span className="font-semibold tabular-nums text-navy">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Gauge showing how far a value sits along a 0..1 scale (leave utilization, absence rate). The
 * `tone` class colours the filled portion; an unknown value renders an empty, muted track.
 */
export function RatioGauge({ value, toneClass = 'bg-accent', label }: { value: number | null; toneClass?: string; label: string }) {
  const pct = value === null || !Number.isFinite(value) ? 0 : Math.min(100, Math.max(0, value * 100))
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-line/70" role="img" aria-label={label} title={label}>
      <div className={`h-full rounded-full ${toneClass}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

/** Re-exported so a consumer can build a chart-adjacent element on the same scale maths. */
export { barHeights, chartMax }
