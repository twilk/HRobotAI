'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { IconCalendar } from '@/components/icons'
import { IconChevronLeft, IconChevronRight, IconWand, IconAlert } from './grafik-icons'
import { ScheduleGrid, cellKey } from './schedule-grid'
import { ShiftEditor, type LocationOption } from './shift-editor'
import { SolveResultBanner } from './solve-result-banner'
import { MetricsStrip } from './metrics-strip'
import { locationName, unitName } from '@/lib/demo-locations'
import {
  formatWeekRange,
  grafikApi,
  GrafikApiError,
  mondayOf,
  normalizeDate,
  shiftWeek,
  weekDates,
  type CreateShiftInput,
  type Employee,
  type Shift,
  type ShiftDemand,
  type SolveResult,
} from '@/lib/grafik'

const ALL_UNITS = '__all__'

/** Editor target: an existing shift (edit) or a fresh cell (create). */
type EditorState =
  | { mode: 'edit'; shift: Shift }
  | { mode: 'create'; employeeId: string; date: string }
  | null

function describeError(err: unknown): string {
  if (err instanceof GrafikApiError) {
    if (err.status === 401)
      return 'Brak autoryzacji do tenant-runtime. Ustaw token (Authorization / hrobot_token / TENANT_RUNTIME_DEV_TOKEN) — patrz opis PR.'
    if (err.status === 502) return 'Backend grafiku (tenant-runtime) jest nieosiągalny. Czy stack compose działa?'
    if (err.status === 403) return 'Brak uprawnień do tej operacji (RBAC).'
    return `Błąd API (${err.status}): ${err.message.slice(0, 200)}`
  }
  return err instanceof Error ? err.message : String(err)
}

/**
 * @param canManage true for MANAGER/HR/ADMIN_KLIENTA (generate + manual CRUD). A plain PRACOWNIK
 *        passes false: the backend returns only their own shifts, so the screen is read-only —
 *        no "Generuj grafik", no add/edit affordances.
 */
export function GrafikScreen({ canManage = true }: { canManage?: boolean }) {
  const [mondayIso, setMondayIso] = useState(() => mondayOf(new Date()).toISOString().slice(0, 10))
  const [employees, setEmployees] = useState<Employee[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [demands, setDemands] = useState<ShiftDemand[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [unitFilter, setUnitFilter] = useState<string>(ALL_UNITS)

  const [solving, setSolving] = useState(false)
  const [solveResult, setSolveResult] = useState<SolveResult | null>(null)

  const [editor, setEditor] = useState<EditorState>(null)
  const [editorBusy, setEditorBusy] = useState(false)
  const [editorError, setEditorError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [emps, shs, dms] = await Promise.all([grafikApi.employees(), grafikApi.shifts(), grafikApi.demands()])
      setEmployees(emps)
      setShifts(shs)
      setDemands(dms)
    } catch (err) {
      setLoadError(describeError(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const reloadSchedule = useCallback(async () => {
    const [shs, dms] = await Promise.all([grafikApi.shifts(), grafikApi.demands()])
    setShifts(shs)
    setDemands(dms)
  }, [])

  const days = useMemo(() => weekDates(mondayIso), [mondayIso])
  const daySet = useMemo(() => new Set(days), [days])

  // Distinct units present in the roster → the scope filter (we have no unit-name API, so short ids).
  const unitOptions = useMemo(() => {
    const ids = [...new Set(employees.map((e) => e.unitId))].filter(Boolean).sort()
    return ids.map((id) => ({ id, label: unitName(id) }))
  }, [employees])

  const visibleEmployees = useMemo(() => {
    // Read-only (PRACOWNIK): the backend already scopes shifts to self, so show ONLY the rows the
    // employee owns — a "my schedule" view, not the whole roster with 30+ empty rows.
    if (!canManage) {
      const own = new Set(shifts.map((s) => s.employeeId))
      return employees.filter((e) => own.has(e.id))
    }
    return unitFilter === ALL_UNITS ? employees : employees.filter((e) => e.unitId === unitFilter)
  }, [employees, shifts, unitFilter, canManage])

  // Location labels (no location-name API → stable short label from the UUID).
  const locationLabel = useCallback((id: string) => locationName(id), [])
  const locationOptions = useMemo<LocationOption[]>(() => {
    const ids = new Set<string>()
    shifts.forEach((s) => ids.add(s.lokalizacjaId))
    demands.forEach((d) => ids.add(d.lokalizacjaId))
    return [...ids].sort().map((id) => ({ id, label: locationLabel(id) }))
  }, [shifts, demands, locationLabel])

  const demandsById = useMemo(() => new Map(demands.map((d) => [d.id, d])), [demands])

  // Shifts for the current week × unit filter, bucketed by (employee, day) cell.
  const shiftsByCell = useMemo(() => {
    const allow = new Set(visibleEmployees.map((e) => e.id))
    const map = new Map<string, Shift[]>()
    for (const s of shifts) {
      const date = normalizeDate(s.date)
      if (!daySet.has(date) || !allow.has(s.employeeId)) continue
      const key = cellKey(s.employeeId, date)
      const bucket = map.get(key)
      if (bucket) bucket.push(s)
      else map.set(key, [s])
    }
    for (const bucket of map.values()) bucket.sort((a, b) => a.start.localeCompare(b.start))
    return map
  }, [shifts, visibleEmployees, daySet])

  const weekShiftCount = useMemo(() => {
    let n = 0
    for (const bucket of shiftsByCell.values()) n += bucket.length
    return n
  }, [shiftsByCell])

  const weekDemandCount = useMemo(
    () => demands.filter((d) => daySet.has(normalizeDate(d.date))).length,
    [demands, daySet],
  )

  // Σ requiredCount over the solved week's demands → denominator of the coverage metric.
  // A solve result always belongs to the currently-viewed week (goWeek clears it), so daySet matches.
  const weekRequiredCount = useMemo(
    () =>
      demands
        .filter((d) => daySet.has(normalizeDate(d.date)))
        .reduce((sum, d) => sum + d.requiredCount, 0),
    [demands, daySet],
  )

  const goWeek = (delta: number) => {
    setMondayIso((iso) => shiftWeek(iso, delta))
    setSolveResult(null)
  }

  async function generate() {
    setSolving(true)
    setSolveResult(null)
    setLoadError(null)
    try {
      const result = await grafikApi.solve({
        weekStart: mondayIso,
        ...(unitFilter !== ALL_UNITS ? { unitId: unitFilter } : {}),
      })
      setSolveResult(result)
      await reloadSchedule()
    } catch (err) {
      setLoadError(describeError(err))
    } finally {
      setSolving(false)
    }
  }

  async function submitShift(input: CreateShiftInput) {
    if (!editor) return
    setEditorBusy(true)
    setEditorError(null)
    try {
      if (editor.mode === 'edit') {
        await grafikApi.updateShift(editor.shift.id, input)
      } else {
        await grafikApi.createShift(input)
      }
      await reloadSchedule()
      setEditor(null)
    } catch (err) {
      setEditorError(describeError(err))
    } finally {
      setEditorBusy(false)
    }
  }

  async function deleteShift() {
    if (editor?.mode !== 'edit') return
    setEditorBusy(true)
    setEditorError(null)
    try {
      await grafikApi.deleteShift(editor.shift.id)
      await reloadSchedule()
      setEditor(null)
    } catch (err) {
      setEditorError(describeError(err))
    } finally {
      setEditorBusy(false)
    }
  }

  return (
    <div className="max-w-[1180px] mx-auto">
      <div className="flex items-end justify-between gap-4 mb-[22px] flex-wrap">
        <div>
          <h1 className="font-display font-extrabold text-[26px] tracking-tightish text-navy leading-tight">Grafik</h1>
          <p className="text-muted text-sm mt-1.5">
            {weekShiftCount} {weekShiftCount === 1 ? 'zmiana' : 'zmian'} · {weekDemandCount} zapotrzebowań w tym tygodniu
          </p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          {canManage && unitOptions.length > 0 ? (
            <select
              aria-label="Filtr jednostki"
              value={unitFilter}
              onChange={(e) => setUnitFilter(e.target.value)}
              className="h-10 px-3 rounded-sm border border-line-strong bg-card text-sm text-ink focus:outline-none focus:border-accent"
            >
              <option value={ALL_UNITS}>Wszystkie jednostki</option>
              {unitOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          ) : null}
          {canManage ? (
            <Button onClick={generate} disabled={solving || loading} className="h-10 px-3.5 text-sm">
              <IconWand className="w-[17px] h-[17px]" strokeWidth={1.7} />
              {solving ? 'Generowanie…' : 'Generuj grafik'}
            </Button>
          ) : (
            <Badge className="h-10 px-3.5 inline-flex items-center gap-1.5 text-[12.5px] bg-card-2 border-line-strong text-muted">
              <IconCalendar className="w-[15px] h-[15px]" strokeWidth={1.7} />
              Twój grafik — podgląd
            </Badge>
          )}
        </div>
      </div>

      {/* Week navigator */}
      <div className="flex items-center gap-2 mb-4">
        <button
          type="button"
          onClick={() => goWeek(-1)}
          aria-label="Poprzedni tydzień"
          className="grid place-items-center w-9 h-9 rounded-sm border border-line-strong bg-card text-ink hover:bg-card-2"
        >
          <IconChevronLeft className="w-[18px] h-[18px]" strokeWidth={1.7} />
        </button>
        <div className="grid place-items-center h-9 px-3 rounded-sm border border-line-strong bg-card min-w-[210px]">
          <span className="text-sm font-medium text-navy">{formatWeekRange(mondayIso)}</span>
        </div>
        <button
          type="button"
          onClick={() => goWeek(1)}
          aria-label="Następny tydzień"
          className="grid place-items-center w-9 h-9 rounded-sm border border-line-strong bg-card text-ink hover:bg-card-2"
        >
          <IconChevronRight className="w-[18px] h-[18px]" strokeWidth={1.7} />
        </button>
        <Button
          variant="ghost"
          onClick={() => setMondayIso(mondayOf(new Date()).toISOString().slice(0, 10))}
          className="h-9 px-3 text-[13px] ml-1"
        >
          Dziś
        </Button>
        <span className="ml-auto flex items-center gap-3 text-[11px] text-muted-2">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-accent/[0.15] border border-accent/30" /> AUTO
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-card-2 border border-line-strong" /> ręczna
          </span>
        </span>
      </div>

      {solveResult ? (
        <>
          <SolveResultBanner
            result={solveResult}
            demandsById={demandsById}
            locationLabel={locationLabel}
            onDismiss={() => setSolveResult(null)}
          />
          <MetricsStrip result={solveResult} requiredCountTotal={weekRequiredCount} />
        </>
      ) : null}

      {loadError ? (
        <div className="rounded-lg border border-error/30 bg-error/[0.05] px-4 py-3 mb-5 flex items-start gap-3" role="alert">
          <IconAlert className="w-[18px] h-[18px] text-error shrink-0 mt-0.5" strokeWidth={1.8} />
          <div className="flex-1 text-[13.5px] text-ink">{loadError}</div>
          <button type="button" onClick={() => void load()} className="text-[13px] font-medium text-accent-ink hover:underline">
            Ponów
          </button>
        </div>
      ) : null}

      {loading ? (
        <div className="grid place-items-center py-24 text-muted text-sm">Ładowanie grafiku…</div>
      ) : employees.length === 0 && !loadError ? (
        <EmptyState icon={IconCalendar} title="Brak pracowników">
          Dodaj pracowników w module Pracownicy, aby zaplanować dla nich grafik.
        </EmptyState>
      ) : visibleEmployees.length === 0 ? (
        <EmptyState icon={IconCalendar} title="Brak pracowników w tej jednostce">
          Zmień filtr jednostki, aby zobaczyć grafik.
        </EmptyState>
      ) : (
        <ScheduleGrid
          employees={visibleEmployees}
          days={days}
          shiftsByCell={shiftsByCell}
          locationLabel={locationLabel}
          readOnly={!canManage}
          onAddShift={(employeeId, date) => {
            setEditorError(null)
            setEditor({ mode: 'create', employeeId, date })
          }}
          onEditShift={(shift) => {
            setEditorError(null)
            setEditor({ mode: 'edit', shift })
          }}
        />
      )}

      {editor ? (
        <ShiftEditor
          shift={editor.mode === 'edit' ? editor.shift : null}
          defaults={editor.mode === 'create' ? { employeeId: editor.employeeId, date: editor.date } : { employeeId: '', date: mondayIso }}
          employees={employees}
          locations={locationOptions}
          busy={editorBusy}
          error={editorError}
          onSubmit={submitShift}
          onDelete={deleteShift}
          onClose={() => setEditor(null)}
        />
      ) : null}
    </div>
  )
}
