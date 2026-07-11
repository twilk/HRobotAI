'use client'

import { Badge } from '@/components/ui/badge'
import { IconCheck, IconClose } from '@/components/icons'
import { IconAlert } from './grafik-icons'
import { normalizeDate, type ShiftDemand, type SolveResult } from '@/lib/grafik'

export interface SolveResultBannerProps {
  result: SolveResult
  demandsById: Map<string, ShiftDemand>
  locationLabel: (id: string) => string
  onDismiss: () => void
}

/**
 * After "Generuj grafik": a green summary on OPTIMAL/FEASIBLE, or an amber banner on INFEASIBLE
 * (or any feasible-but-partial solve) that lists every uncovered slot from `unmet[]` — resolving
 * each `demandId` to its location/day/role so the user sees *what* the solver could not staff.
 */
export function SolveResultBanner({ result, demandsById, locationLabel, onDismiss }: SolveResultBannerProps) {
  const infeasible = result.status === 'INFEASIBLE'
  const hasGaps = result.unmet.length > 0
  const tone = infeasible || hasGaps ? 'warn' : 'ok'

  return (
    <div
      className={
        tone === 'ok'
          ? 'rounded-lg border border-verified/30 bg-verified/[0.06] px-4 py-3.5 mb-5'
          : 'rounded-lg border border-warn/40 bg-warn/[0.07] px-4 py-3.5 mb-5'
      }
      role="status"
    >
      <div className="flex items-start gap-3">
        <span
          className={
            tone === 'ok'
              ? 'grid place-items-center w-7 h-7 shrink-0 rounded-md text-verified bg-verified/10'
              : 'grid place-items-center w-7 h-7 shrink-0 rounded-md text-warn bg-warn/10'
          }
        >
          {tone === 'ok' ? (
            <IconCheck className="w-[17px] h-[17px]" strokeWidth={2} />
          ) : (
            <IconAlert className="w-[17px] h-[17px]" strokeWidth={1.8} />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-navy text-[14.5px]">
              {infeasible
                ? 'Nie udało się w pełni ułożyć grafiku'
                : hasGaps
                  ? 'Grafik ułożony częściowo'
                  : 'Grafik wygenerowany'}
            </span>
            <Badge tone={tone === 'ok' ? 'ok' : 'warn'}>{result.status}</Badge>
            <span className="text-[13px] text-muted">
              {result.assignmentsCreated} {plural(result.assignmentsCreated)} zapisano
            </span>
          </div>

          {hasGaps ? (
            <>
              <p className="text-[13px] text-muted mt-1.5">
                Nieobsadzone zapotrzebowania ({result.unmet.length}):
              </p>
              <ul className="mt-1.5 space-y-1">
                {result.unmet.map((u) => {
                  const d = demandsById.get(u.demandId)
                  return (
                    <li key={u.demandId} className="text-[13px] text-ink flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">
                        {d
                          ? `${locationLabel(d.lokalizacjaId)} · ${normalizeDate(d.date)} · ${d.start}–${d.end} · ${d.requiredRole}`
                          : `Zapotrzebowanie ${u.demandId.slice(0, 8)}`}
                      </span>
                      <span className="text-muted-2">— {u.reason}</span>
                    </li>
                  )
                })}
              </ul>
            </>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Zamknij"
          className="grid place-items-center w-7 h-7 shrink-0 rounded-sm text-muted hover:bg-card-2"
        >
          <IconClose className="w-4 h-4" strokeWidth={1.7} />
        </button>
      </div>
    </div>
  )
}

function plural(n: number): string {
  if (n === 1) return 'zmianę'
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'zmiany'
  return 'zmian'
}
