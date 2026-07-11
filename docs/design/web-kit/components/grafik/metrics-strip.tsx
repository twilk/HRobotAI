'use client'

import { deriveGrafikMetrics, type SolveResult } from '@/lib/grafik'

export interface MetricsStripProps {
  result: SolveResult
  /** Σ requiredCount over the solved week's demands (for the coverage ratio). */
  requiredCountTotal: number
}

/**
 * J3: a compact, read-only row of aggregate solve metrics 4Mobility expects after "Generuj grafik".
 * Everything is derived from the SolveResult already in the view + the loaded demands — no backend
 * call. `fairnessScore` is intentionally omitted (M3 placeholder, always 0). Renders on every solve
 * status (incl. INFEASIBLE), sitting alongside the SolveResultBanner's unmet list.
 */
export function MetricsStrip({ result, requiredCountTotal }: MetricsStripProps) {
  const m = deriveGrafikMetrics(result, requiredCountTotal)
  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-px rounded-lg border border-line-strong bg-line-strong overflow-hidden mb-5"
      role="group"
      aria-label="Podsumowanie grafiku"
    >
      <StatTile label="Dojazdy" value={m.commuteLabel} hint="łączny czas dojazdów" />
      <StatTile label="Odchyłka etatu" value={m.etatDeviationLabel} hint="suma |przepracowane − cel|" />
      <StatTile label="Godziny" value={m.scheduledHoursLabel} hint="łączny czas zaplanowanych zmian" />
      <StatTile label="Pokrycie" value={m.coverageLabel} hint="obsadzone / wymagane" />
      <StatTile
        label="Preferencje uwzględnione"
        value={m.preferencesHonoredLabel}
        hint="odsetek obsadzeń zgodnych z preferencjami pracownika"
      />
    </div>
  )
}

function StatTile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="bg-card px-4 py-3" title={hint}>
      <div className="text-[11px] uppercase tracking-[.06em] text-muted-2 font-medium">{label}</div>
      <div className="text-[17px] font-semibold text-navy tabular-nums mt-1 leading-tight">{value}</div>
    </div>
  )
}
