'use client'

import { useState } from 'react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { IconChevronLeft, IconClose } from '@/components/icons'
import { type Facility, DAY_LABELS, dayHours, formatDayHours } from '@/lib/facilities'
import {
  type Shift,
  type SeedShift,
  startOfWeek,
  addDays,
  weekDates,
  ymd,
  materializeWeek,
  employeeWeekHours,
  shiftHours,
  minutesOf,
  newShiftId,
} from '@/lib/schedule'
import { createShift, deleteShift } from '@/lib/actions/grafik-actions'

interface Emp {
  id: string
  firstName: string
  lastName: string
  position: string
}

function parseYmd(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function hourSlots(open: string, close: string): string[] {
  const out: string[] = []
  for (let m = minutesOf(open); m <= minutesOf(close); m += 60) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
  }
  return out
}

const fmtHours = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','))

/**
 * Fully interactive weekly Grafik. Pick a placówka, navigate weeks, add/remove
 * shifts (defaulting to the placówka's working hours), and watch the per-person
 * and total hours update live. The current week is pre-populated from the seed;
 * other weeks start empty and are built up.
 */
export function ScheduleGrid({
  facilities,
  employees,
  seed,
  todayISO,
}: {
  facilities: Facility[]
  employees: Emp[]
  seed: SeedShift[]
  todayISO: string
}) {
  const anchorMon = startOfWeek(parseYmd(todayISO))
  const [shifts, setShifts] = useState<Shift[]>(() =>
    facilities.flatMap((f) => materializeWeek(seed, anchorMon, f.id)),
  )
  const [facilityId, setFacilityId] = useState(facilities[0]?.id ?? '')
  const [weekOffset, setWeekOffset] = useState(0)
  const [adding, setAdding] = useState<{ employeeId: string; dayIndex: number } | null>(null)

  const facility = facilities.find((f) => f.id === facilityId) ?? facilities[0]
  const weekStart = addDays(anchorMon, weekOffset * 7)
  const days = weekDates(weekStart)
  const dayIso = days.map(ymd)
  const dayIsoSet = new Set(dayIso)
  const rowEmployees = employees.filter((e) => facility.employeeIds.includes(e.id))
  const visible = shifts.filter((s) => s.facilityId === facility.id && dayIsoSet.has(s.date))

  const totalHours = visible.reduce((sum, s) => sum + shiftHours(s), 0)
  const todayIso = ymd(parseYmd(todayISO))

  function addShift(employeeId: string, dayIndex: number, start: string, end: string) {
    if (minutesOf(end) <= minutesOf(start)) return
    // Optimistic update — instant UI feedback
    setShifts((prev) => [
      ...prev,
      { id: newShiftId(), employeeId, facilityId: facility.id, date: dayIso[dayIndex], start, end },
    ])
    setAdding(null)
    // Persist to server (fire-and-forget, optimistic state stays)
    void createShift({
      facilityId: facility.id,
      employeeId,
      employeeName: '',
      weekStart: ymd(weekStart),
      dayIndex,
      startTime: start,
      endTime: end,
    })
  }

  function removeShift(id: string) {
    // Optimistic update — instant UI feedback
    setShifts((prev) => prev.filter((s) => s.id !== id))
    // Persist to server (fire-and-forget, optimistic state stays)
    void deleteShift(id)
  }

  const weekLabel = `${days[0].getDate()}.${days[0].getMonth() + 1} – ${days[6].getDate()}.${days[6].getMonth() + 1}.${days[6].getFullYear()}`

  return (
    <div className="mx-auto max-w-[1120px]">
      {/* header */}
      <div className="mb-[22px] flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[26px] font-extrabold leading-tight tracking-tightish text-navy">Grafik</h1>
          <p className="mt-1.5 text-sm text-muted">
            {facility.name} · <span className="text-muted-2">{facility.location}</span>
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <label htmlFor="facility" className="sr-only">
            Placówka
          </label>
          <select
            id="facility"
            value={facilityId}
            onChange={(e) => {
              setFacilityId(e.target.value)
              setAdding(null)
            }}
            data-guide="grafik:facility-filter"
            className="h-10 rounded-sm border border-line-strong bg-card px-3 text-sm text-ink focus:border-accent focus:outline-none"
          >
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* week nav */}
      <div className="mb-3.5 flex items-center gap-2" data-guide="grafik:week-nav">
        <button
          onClick={() => setWeekOffset((w) => w - 1)}
          aria-label="Poprzedni tydzień"
          className="grid h-9 w-9 place-items-center rounded-sm border border-line-strong bg-card text-muted hover:bg-card-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <IconChevronLeft className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </button>
        <button
          onClick={() => setWeekOffset((w) => w + 1)}
          aria-label="Następny tydzień"
          className="grid h-9 w-9 place-items-center rounded-sm border border-line-strong bg-card text-muted hover:bg-card-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <IconChevronLeft className="h-[18px] w-[18px] rotate-180" strokeWidth={1.8} />
        </button>
        <div className="ml-1 font-mono text-[13px] text-ink">{weekLabel}</div>
        {weekOffset === 0 ? (
          <span className="rounded-full border border-accent/20 bg-accent/[0.06] px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[.08em] text-accent-ink">
            Ten tydzień
          </span>
        ) : (
          <button onClick={() => setWeekOffset(0)} className="font-mono text-[11px] text-accent-ink hover:underline">
            Wróć do dziś
          </button>
        )}
        <div className="ml-auto font-mono text-[11.5px] text-muted">
          Suma: <span className="font-medium text-ink">{fmtHours(totalHours)} h</span>
        </div>
      </div>

      {/* grid */}
      <div className="overflow-x-auto rounded-lg border border-line bg-card shadow-sm">
        <div className="min-w-[860px]">
          {/* day header */}
          <div className="grid grid-cols-[190px_repeat(7,1fr)] border-b border-line bg-card-2">
            <div className="px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[.08em] text-muted-2">Pracownik</div>
            {days.map((d, i) => {
              const dh = dayHours(facility, i)
              const isToday = ymd(d) === todayIso
              return (
                <div
                  key={i}
                  className={cn('border-l border-line px-2 py-2 text-center', !dh && 'bg-canvas/60')}
                >
                  <div className="flex items-center justify-center gap-1.5">
                    <span className={cn('text-[12px] font-semibold', dh ? 'text-navy' : 'text-muted-2')}>
                      {DAY_LABELS[i]}
                    </span>
                    <span
                      className={cn(
                        'font-mono text-[11px]',
                        isToday ? 'rounded bg-accent px-1.5 text-white' : 'text-muted-2',
                      )}
                    >
                      {d.getDate()}.{d.getMonth() + 1}
                    </span>
                  </div>
                  <div className={cn('mt-0.5 font-mono text-[10px]', dh ? 'text-muted' : 'text-muted-2')}>
                    {formatDayHours(dh)}
                  </div>
                </div>
              )
            })}
          </div>

          {/* employee rows */}
          {rowEmployees.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted">Brak pracowników przypisanych do tej placówki.</div>
          ) : (
            rowEmployees.map((emp) => {
              const wkHours = employeeWeekHours(visible, emp.id)
              return (
                <div key={emp.id} className="grid grid-cols-[190px_repeat(7,1fr)] border-b border-line last:border-0" data-guide="grafik:shift-row">
                  <div className="flex items-center gap-2.5 px-4 py-3">
                    <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-gradient-to-b from-navy-700 to-navy text-[10.5px] font-semibold text-white">
                      {(emp.firstName[0] + emp.lastName[0]).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[13.5px] font-medium text-ink">
                        {emp.firstName} {emp.lastName}
                      </div>
                      <div className="font-mono text-[10.5px] text-muted-2">{fmtHours(wkHours)} h / tydz.</div>
                    </div>
                  </div>
                  {days.map((d, i) => {
                    const dh = dayHours(facility, i)
                    const iso = dayIso[i]
                    const cellShifts = visible.filter((s) => s.employeeId === emp.id && s.date === iso)
                    const isAdding = adding?.employeeId === emp.id && adding?.dayIndex === i
                    return (
                      <div key={i} className={cn('min-h-[58px] border-l border-line p-1.5', !dh && 'bg-canvas/50')} data-guide="grafik:shift-cell">
                        {!dh ? (
                          <div className="grid h-full place-items-center font-mono text-[10px] text-muted-2">—</div>
                        ) : isAdding ? (
                          <AddForm dh={dh} onAdd={(s, e) => addShift(emp.id, i, s, e)} onCancel={() => setAdding(null)} />
                        ) : (
                          <div className="flex flex-col gap-1">
                            {cellShifts.map((s) => (
                              <div
                                key={s.id}
                                className="group/chip relative rounded-md border border-accent/25 bg-accent/[0.07] px-2 py-1 text-center"
                              >
                                <span className="font-mono text-[11.5px] text-accent-ink">
                                  {s.start}–{s.end}
                                </span>
                                <button
                                  onClick={() => removeShift(s.id)}
                                  aria-label={`Usuń zmianę ${s.start}–${s.end}`}
                                  data-guide="grafik:remove-shift"
                                  className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full border border-line-strong bg-card text-muted opacity-0 transition-opacity group-hover/chip:opacity-100 group-focus-within/chip:opacity-100 focus:opacity-100 hover:text-error focus-visible:ring-2 focus-visible:ring-accent/40 focus:outline-none"
                                >
                                  <IconClose className="h-2.5 w-2.5" strokeWidth={2.2} />
                                  <span className="sr-only">Usuń zmianę</span>
                                </button>
                              </div>
                            ))}
                            <button
                              onClick={() => setAdding({ employeeId: emp.id, dayIndex: i })}
                              data-guide="grafik:add-shift"
                              className="rounded-md border border-dashed border-line-strong py-1 text-[11px] text-muted-2 hover:border-accent/40 hover:text-accent-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                            >
                              + dodaj
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>
      </div>

      <p className="mt-3 font-mono text-[11px] text-muted-2">
        Kliknij „+ dodaj”, aby zaplanować zmianę (domyślnie godziny pracy placówki). Najedź na zmianę, aby ją usunąć.
      </p>
    </div>
  )
}

function AddForm({ dh, onAdd, onCancel }: { dh: { open: string; close: string }; onAdd: (s: string, e: string) => void; onCancel: () => void }) {
  const slots = hourSlots(dh.open, dh.close)
  const [start, setStart] = useState(dh.open)
  const [end, setEnd] = useState(dh.close)
  return (
    <div className="flex flex-col gap-1 rounded-md border border-accent/30 bg-card p-1.5">
      <div className="flex items-center gap-1">
        <select
          aria-label="Początek zmiany"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="h-7 w-full rounded border border-line-strong bg-card px-1 font-mono text-[11px] focus:border-accent focus:outline-none"
        >
          {slots.slice(0, -1).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <span className="text-muted-2">–</span>
        <select
          aria-label="Koniec zmiany"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          className="h-7 w-full rounded border border-line-strong bg-card px-1 font-mono text-[11px] focus:border-accent focus:outline-none"
        >
          {slots.slice(1).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-1">
        <Button onClick={() => onAdd(start, end)} className="h-7 flex-1 px-2 text-[11px]">
          Dodaj
        </Button>
        <button
          onClick={onCancel}
          className="h-7 rounded-sm border border-line-strong px-2 text-[11px] text-muted hover:bg-card-2"
        >
          Anuluj
        </button>
      </div>
    </div>
  )
}
