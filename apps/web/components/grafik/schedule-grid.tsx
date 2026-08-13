'use client'

import { dayOfMonth, WEEKDAY_LABELS, type Employee, type Shift } from '@/lib/grafik'
import { IconPlus } from '@/components/icons'
import { roleBar } from '@/lib/grafik-roles'

export interface ScheduleGridProps {
  employees: Employee[]
  /** 7 ISO dates, Mon→Sun. */
  days: string[]
  /** Keyed `${employeeId}|${isoDate}` → the shifts in that cell. */
  shiftsByCell: Map<string, Shift[]>
  locationLabel: (id: string) => string
  onAddShift: (employeeId: string, date: string) => void
  onEditShift: (shift: Shift) => void
  /** Employee (PRACOWNIK) view: shifts render as static chips, no add/edit affordances. */
  readOnly?: boolean
}

const todayLike = (iso: string, today: string): boolean => iso === today

/** days[] is always Mon→Sun, so the last two entries are the weekend. */
const isWeekend = (i: number): boolean => i >= 5

/**
 * Row hover. Has to be opaque: the sticky name cell inherits the row's background to carry the
 * zebra across all seven columns, and a translucent value there would let scrolled cells show
 * through. This is `accent` at ~4% flattened onto the card.
 */
const ROW_HOVER = 'hover:bg-[#F2F8F9]'

export function cellKey(employeeId: string, date: string): string {
  return `${employeeId}|${date}`
}

export function ScheduleGrid({
  employees,
  days,
  shiftsByCell,
  locationLabel,
  onAddShift,
  onEditShift,
  readOnly = false,
}: ScheduleGridProps) {
  const today = new Date().toISOString().slice(0, 10)

  return (
    // max-h + overflow-auto (not just overflow-x-auto) is what gives the sticky header a vertical
    // axis to pin against — without it the wrapper is a scroll container that never scrolls down.
    <div className="max-h-[calc(100vh-330px)] overflow-auto border border-line rounded-lg bg-card shadow-sm">
      <table className="w-full table-fixed border-separate border-spacing-0 min-w-[1000px]">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 bg-card-2 text-left font-mono text-[10.5px] tracking-[.08em] uppercase text-muted-2 px-4 py-[13px] border-b border-line w-[190px]">
              Pracownik
            </th>
            {days.map((iso, i) => (
              <th
                key={iso}
                className={`sticky top-0 z-20 text-center font-mono text-[10.5px] tracking-[.08em] uppercase px-2 py-[10px] border-b border-l border-line ${
                  // Header backgrounds must be opaque now that the row is sticky, so "today" is
                  // accent/6% pre-flattened onto card-2 rather than layered over it.
                  todayLike(iso, today)
                    ? 'bg-[#EDF4F1] text-accent-ink'
                    : isWeekend(i)
                      ? 'bg-[#F0ECE0] text-muted-2'
                      : 'bg-card-2 text-muted-2'
                }`}
              >
                <div>{WEEKDAY_LABELS[i]}</div>
                <div className="text-[13px] font-sans font-semibold tracking-normal text-ink mt-0.5">
                  {dayOfMonth(iso)}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {employees.map((emp) => {
            const onShiftThisWeek = days.some(
              (iso) => (shiftsByCell.get(cellKey(emp.id, iso))?.length ?? 0) > 0,
            )
            return (
              // Zebra + hover live on the row; the sticky name cell inherits that background so both
              // read across all seven columns while staying opaque under horizontal scroll.
              <tr key={emp.id} className={`group bg-card even:bg-canvas ${ROW_HOVER}`}>
                <td className="sticky left-0 z-10 bg-inherit px-4 py-[11px] border-b border-line align-top">
                  <div className="flex items-center gap-[9px]">
                    <span className="grid place-items-center w-[26px] h-[26px] shrink-0 rounded-lg bg-gradient-to-b from-navy-700 to-navy text-white text-[10px] font-semibold">
                      {initials(emp)}
                    </span>
                    <div className="min-w-0">
                      <div
                        className={`text-[13.5px] leading-tight truncate ${
                          onShiftThisWeek ? 'font-medium' : 'font-normal text-muted-2'
                        }`}
                      >
                        {emp.firstName} {emp.lastName}
                      </div>
                      {emp.position ? (
                        <div className="text-[11px] text-muted-2 truncate">{emp.position}</div>
                      ) : null}
                    </div>
                  </div>
                </td>

                {days.map((iso, i) => {
                  const shifts = shiftsByCell.get(cellKey(emp.id, iso)) ?? []
                  // Column tints are translucent on purpose: they layer over the row's zebra/hover
                  // colour instead of replacing it, so both axes stay readable at once.
                  const columnTint = todayLike(iso, today)
                    ? 'bg-accent/[0.05]'
                    : isWeekend(i)
                      ? 'bg-line/[0.55]'
                      : ''
                  return (
                    <td key={iso} className={`border-b border-l border-line p-1 align-top ${columnTint}`}>
                      <div className="flex flex-col gap-1 min-h-[46px]">
                        {shifts.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={readOnly ? undefined : () => onEditShift(s)}
                            aria-disabled={readOnly || undefined}
                            title={`${s.role} · ${locationLabel(s.lokalizacjaId)} · ${
                              s.source === 'AUTO' ? 'ułożone automatycznie' : 'wpisane ręcznie'
                            }`}
                            className={`w-full text-left rounded-sm px-2 py-[3px] border transition-colors ${roleBar(
                              s.role,
                            )} ${readOnly ? 'cursor-default ' : ''}${
                              // Solid vs dashed carries AUTO vs manual on its own, so the word does
                              // not have to — it reads in greyscale and costs no width.
                              s.source === 'AUTO'
                                ? `bg-accent/[0.07] border-accent/25${readOnly ? '' : ' hover:border-accent/50'}`
                                : `bg-card-2 border-dashed border-line-strong${readOnly ? '' : ' hover:border-navy/40'}`
                            }`}
                          >
                            <div className="font-mono text-[11px] tabular-nums text-ink leading-[1.35]">
                              {s.start}–{s.end}
                            </div>
                            <div className="font-mono text-[10.5px] tracking-[.04em] uppercase text-muted leading-[1.35]">
                              {s.role}
                            </div>
                            {/* Full name, wrapped rather than cut. The longest unbreakable token in
                                the seed is ~56px against a 90px column, and `break-words` is the
                                backstop for anything longer the backend ever sends. */}
                            <div className="text-[10px] leading-[1.2] text-muted-2 break-words mt-px">
                              {locationLabel(s.lokalizacjaId)}
                            </div>
                          </button>
                        ))}

                        {readOnly ? null : (
                          <button
                            type="button"
                            onClick={() => onAddShift(emp.id, iso)}
                            aria-label={`Dodaj zmianę — ${emp.firstName} ${emp.lastName}, ${iso}`}
                            className="grid place-items-center h-[22px] rounded-sm text-muted-2 opacity-0 group-hover:opacity-100 hover:bg-card-2 hover:text-accent-ink focus:opacity-100 transition-opacity"
                          >
                            <IconPlus className="w-[15px] h-[15px]" strokeWidth={1.8} />
                          </button>
                        )}
                      </div>
                    </td>
                  )
                })}
              </tr>
              )
          })}
        </tbody>
      </table>
    </div>
  )
}

function initials(e: Employee): string {
  return ((e.firstName.charAt(0) || '') + (e.lastName.charAt(0) || '')).toUpperCase()
}
