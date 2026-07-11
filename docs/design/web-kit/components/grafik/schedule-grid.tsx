'use client'

import { dayOfMonth, WEEKDAY_LABELS, type Employee, type Shift } from '@/lib/grafik'
import { IconPlus } from '@/components/icons'

export interface ScheduleGridProps {
  employees: Employee[]
  /** 7 ISO dates, Mon→Sun. */
  days: string[]
  /** Keyed `${employeeId}|${isoDate}` → the shifts in that cell. */
  shiftsByCell: Map<string, Shift[]>
  locationLabel: (id: string) => string
  onAddShift: (employeeId: string, date: string) => void
  onEditShift: (shift: Shift) => void
}

const todayLike = (iso: string, today: string): boolean => iso === today

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
}: ScheduleGridProps) {
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="overflow-x-auto border border-line rounded-lg bg-card shadow-sm">
      <table className="w-full border-separate border-spacing-0 min-w-[880px]">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-card-2 text-left font-mono text-[10.5px] tracking-[.08em] uppercase text-muted-2 px-4 py-[13px] border-b border-line w-[190px]">
              Pracownik
            </th>
            {days.map((iso, i) => (
              <th
                key={iso}
                className={`text-center font-mono text-[10.5px] tracking-[.08em] uppercase px-2 py-[10px] border-b border-l border-line ${
                  todayLike(iso, today) ? 'bg-accent/[0.06] text-accent-ink' : 'bg-card-2 text-muted-2'
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
          {employees.map((emp) => (
            <tr key={emp.id} className="group">
              <td className="sticky left-0 z-10 bg-card px-4 py-[11px] border-b border-line align-top group-hover:bg-card-2">
                <div className="flex items-center gap-[9px]">
                  <span className="grid place-items-center w-[26px] h-[26px] shrink-0 rounded-lg bg-gradient-to-b from-navy-700 to-navy text-white text-[10px] font-semibold">
                    {initials(emp)}
                  </span>
                  <div className="min-w-0">
                    <div className="font-medium text-[13.5px] leading-tight truncate">
                      {emp.firstName} {emp.lastName}
                    </div>
                    {emp.position ? (
                      <div className="text-[11px] text-muted-2 truncate">{emp.position}</div>
                    ) : null}
                  </div>
                </div>
              </td>

              {days.map((iso) => {
                const shifts = shiftsByCell.get(cellKey(emp.id, iso)) ?? []
                return (
                  <td key={iso} className="border-b border-l border-line p-1 align-top">
                    <div className="flex flex-col gap-1 min-h-[46px]">
                      {shifts.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => onEditShift(s)}
                          title={`${locationLabel(s.lokalizacjaId)} · ${s.role}`}
                          className={`w-full text-left rounded-sm px-2 py-1 border transition-colors ${
                            s.source === 'AUTO'
                              ? 'bg-accent/[0.07] border-accent/25 hover:border-accent/50'
                              : 'bg-card-2 border-line-strong hover:border-navy/40'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-mono text-[11px] tabular-nums text-ink">
                              {s.start}–{s.end}
                            </span>
                            <span
                              className={`font-mono text-[8.5px] tracking-[.06em] uppercase ${
                                s.source === 'AUTO' ? 'text-accent-ink' : 'text-muted-2'
                              }`}
                            >
                              {s.source === 'AUTO' ? 'AUTO' : 'RĘCZ'}
                            </span>
                          </div>
                          <div className="text-[11px] text-muted truncate">
                            {shortLoc(locationLabel(s.lokalizacjaId))} · {s.role}
                          </div>
                        </button>
                      ))}

                      <button
                        type="button"
                        onClick={() => onAddShift(emp.id, iso)}
                        aria-label={`Dodaj zmianę — ${emp.firstName} ${emp.lastName}, ${iso}`}
                        className="grid place-items-center h-[22px] rounded-sm text-muted-2 opacity-0 group-hover:opacity-100 hover:bg-card-2 hover:text-accent-ink focus:opacity-100 transition-opacity"
                      >
                        <IconPlus className="w-[15px] h-[15px]" strokeWidth={1.8} />
                      </button>
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function initials(e: Employee): string {
  return ((e.firstName.charAt(0) || '') + (e.lastName.charAt(0) || '')).toUpperCase()
}

/** Trim a long location label so a chip stays one line. */
function shortLoc(label: string): string {
  return label.length > 14 ? `${label.slice(0, 13)}…` : label
}
