'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, Th, Td } from '@/components/ui/table'
import { Field, Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { employeeSelectClass } from '@/lib/employee-profile'
import { contractLabel } from '@/components/employees/employees-screen'
import { unitName } from '@/lib/demo-locations'
import { isoDate, addDays, mondayOf } from '@/lib/grafik'
import {
  kosztyApi,
  formatMoney,
  budgetAlertTone,
  budgetAlertText,
  EMPLOYMENT_TYPES,
  KosztyApiError,
  type CostRate,
  type BudgetStatusResult,
  type EmploymentType,
} from '@/lib/koszty'

/** Roster row shape this panel needs — id + unitId only, to derive the unit selector. */
interface RosterRow {
  id: string
  unitId: string
}

/** Surface the backend's already-humanized message; map a bare RBAC 403 to Polish. */
function kosztyErrorMessage(err: unknown): string {
  if (err instanceof KosztyApiError) {
    if (err.status === 403) return 'Ten zakres kosztów jest poza Twoim dostępem.'
    return err.message || 'Coś poszło nie tak. Spróbuj ponownie.'
  }
  return 'Brak połączenia z serwerem. Spróbuj ponownie.'
}

const BADGE_TONE: Record<'ok' | 'warn' | 'muted', 'ok' | 'warn' | 'muted'> = { ok: 'ok', warn: 'warn', muted: 'muted' }

/** Blank rate-form state — all strings so the inputs stay controlled; parsed on submit. */
interface RateFormState {
  position: string
  employmentType: EmploymentType
  hourlyRate: string
  currency: string
}

const BLANK_RATE_FORM: RateFormState = { position: '', employmentType: 'UMOWA_O_PRACE', hourlyRate: '', currency: 'PLN' }

/**
 * SP4 cost panel: week/unit cost + budget-cap alert + missing-rate report, plus (HR/ADMIN_KLIENTA only)
 * a standard-rate catalog editor. Rendered from app/(tenant)/ai-grafik-manager/page.tsx alongside
 * ProposalInbox, gated the same way the backend gates it (Codex P1-1/P1-3):
 *
 *   • Any MANAGER/HR/ADMIN_KLIENTA sees the week-cost view, but a plain MANAGER MUST pick a unit — the
 *     backend 403s a manager `GET /koszty/week` with no `unitId`, so the unit `<select>` is required
 *     (not "Wszystkie jednostki") whenever `canEditRates` is false.
 *   • Only `canEditRates` (HR/ADMIN_KLIENTA = isGlobal) sees the rate catalog + the add/update form —
 *     this NEVER reuses the ai-grafik config route's MANAGER-inclusive gate; the backend re-checks the
 *     same HR/ADMIN-only rule in `CostService.upsertRate` regardless of what this UI shows.
 *
 * A missing rate is always reported as `missingRates` (position/employmentType/employee count), and a
 * missing/currency-conflicted cost is ALWAYS rendered as "brak stawki" — never "0 zł" (Codex Open-Q).
 */
export function CostPanel({ canEditRates }: { canEditRates: boolean }) {
  const [units, setUnits] = useState<string[]>([])
  const [unitId, setUnitId] = useState<string>('')
  const [weekMonday, setWeekMonday] = useState<Date>(() => mondayOf(new Date()))

  const [status, setStatus] = useState<BudgetStatusResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [rates, setRates] = useState<CostRate[]>([])
  const [ratesError, setRatesError] = useState<string | null>(null)
  const [rateForm, setRateForm] = useState<RateFormState>(BLANK_RATE_FORM)
  const [savingRate, setSavingRate] = useState(false)
  const [saveRateError, setSaveRateError] = useState<string | null>(null)
  const [saveRateOk, setSaveRateOk] = useState(false)

  const cancelledRef = useRef(false)
  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
    }
  }, [])

  // Derive the unit selector from the (already role-scoped) employee roster — GET /api/employees
  // returns only a MANAGER's own managed unit(s), so this never leaks another manager's units.
  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/employees', { cache: 'no-store' })
        if (!res.ok) return
        const roster = (await res.json()) as RosterRow[]
        if (cancelledRef.current) return
        const ids = [...new Set(roster.map((e) => e.unitId))].filter(Boolean).sort()
        setUnits(ids)
        setUnitId((prev) => prev || ids[0] || '')
      } catch {
        /* the week-cost load below will surface its own error if scoping truly fails */
      }
    })()
  }, [])

  const weekStartIso = useMemo(() => isoDate(weekMonday), [weekMonday])
  const weekEndLabel = useMemo(() => isoDate(addDays(weekMonday, 6)), [weekMonday])

  const effectiveUnitId = canEditRates ? unitId || undefined : unitId

  const loadWeek = useCallback(async () => {
    if (!canEditRates && !effectiveUnitId) return // a manager view with no unit yet — nothing to load
    setLoading(true)
    setError(null)
    try {
      const res = await kosztyApi.getWeek({ weekStart: weekStartIso, unitId: effectiveUnitId })
      if (!cancelledRef.current) setStatus(res)
    } catch (err) {
      if (!cancelledRef.current) setError(kosztyErrorMessage(err))
    } finally {
      if (!cancelledRef.current) setLoading(false)
    }
  }, [canEditRates, effectiveUnitId, weekStartIso])

  useEffect(() => {
    void loadWeek()
  }, [loadWeek])

  const loadRates = useCallback(async () => {
    if (!canEditRates) return
    setRatesError(null)
    try {
      const res = await kosztyApi.getRates()
      if (!cancelledRef.current) setRates(res)
    } catch (err) {
      if (!cancelledRef.current) setRatesError(kosztyErrorMessage(err))
    }
  }, [canEditRates])

  useEffect(() => {
    void loadRates()
  }, [loadRates])

  async function submitRate(e: React.FormEvent) {
    e.preventDefault()
    setSaveRateError(null)
    setSaveRateOk(false)

    const position = rateForm.position.trim()
    if (!position) {
      setSaveRateError('Podaj stanowisko.')
      return
    }
    const hourlyRate = Number(rateForm.hourlyRate.replace(',', '.'))
    if (!Number.isFinite(hourlyRate) || hourlyRate < 0) {
      setSaveRateError('Stawka godzinowa musi być liczbą ≥ 0.')
      return
    }

    setSavingRate(true)
    try {
      await kosztyApi.updateRates({
        position,
        employmentType: rateForm.employmentType,
        hourlyRate,
        currency: rateForm.currency.trim() || 'PLN',
      })
      if (cancelledRef.current) return
      setSaveRateOk(true)
      setRateForm(BLANK_RATE_FORM)
      await loadRates()
      await loadWeek() // a newly-added rate can turn a missingRate into a costed shift
    } catch (err) {
      if (!cancelledRef.current) setSaveRateError(kosztyErrorMessage(err))
    } finally {
      if (!cancelledRef.current) setSavingRate(false)
    }
  }

  const tone = status ? budgetAlertTone(status) : 'muted'

  return (
    <div className="max-w-[1120px] mx-auto mb-10">
      <div className="mb-[18px]">
        <h2 className="font-display font-bold text-[19px] text-navy">Koszty grafiku</h2>
        <p className="text-muted text-sm mt-1">
          Koszt tygodnia wg standardowych stawek na stanowisku, w realnych godzinach zmian (bez nadgodzin).
        </p>
      </div>

      <Card className="p-4 mb-4">
        <div className="flex items-end gap-3 flex-wrap mb-4">
          <Field label="Jednostka" htmlFor="costUnit" className="mb-0 w-[220px]">
            <select
              id="costUnit"
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              className={employeeSelectClass}
            >
              {canEditRates && <option value="">Wszystkie jednostki</option>}
              {units.map((id) => (
                <option key={id} value={id}>
                  {unitName(id)}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Tydzień od" htmlFor="costWeek" className="mb-0 w-[160px]">
            <Input
              id="costWeek"
              type="date"
              value={weekStartIso}
              onChange={(e) => e.target.value && setWeekMonday(mondayOf(new Date(e.target.value)))}
            />
          </Field>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              className="h-11 px-3 text-sm"
              onClick={() => setWeekMonday((d) => addDays(d, -7))}
            >
              ← Poprzedni
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-11 px-3 text-sm"
              onClick={() => setWeekMonday((d) => addDays(d, 7))}
            >
              Następny →
            </Button>
          </div>

          <span className="text-muted-2 text-xs self-center">
            {weekStartIso} – {weekEndLabel}
          </span>
        </div>

        {!canEditRates && !unitId ? (
          <div className="text-sm text-muted">Brak przypisanej jednostki — nie można obliczyć kosztu.</div>
        ) : loading ? (
          <div className="text-sm text-muted py-4">Ładowanie kosztu…</div>
        ) : error ? (
          <div role="alert" className="text-sm text-warn border border-warn/30 bg-warn/[0.08] rounded-lg px-3.5 py-2.5">
            {error}
          </div>
        ) : status ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="text-[26px] font-display font-extrabold text-navy tabular-nums">
                {formatMoney(status.cost, status.currency)}
              </div>
              <Badge tone={BADGE_TONE[tone]}>
                {tone === 'warn' ? 'Przekroczono budżet' : tone === 'ok' ? 'W budżecie' : 'Status nieznany'}
              </Badge>
              {status.cap !== null && (
                <span className="text-muted-2 text-xs">limit: {formatMoney(status.cap, status.currency)}</span>
              )}
            </div>

            <div
              role={tone === 'warn' ? 'alert' : 'status'}
              className={
                tone === 'warn'
                  ? 'text-sm text-warn border border-warn/30 bg-warn/[0.08] rounded-lg px-3.5 py-2.5'
                  : tone === 'ok'
                    ? 'text-sm text-verified border border-verified/30 bg-verified/[0.06] rounded-lg px-3.5 py-2.5'
                    : 'text-sm text-muted border border-line-strong bg-card-2 rounded-lg px-3.5 py-2.5'
              }
            >
              {budgetAlertText(status)}
            </div>

            {status.missingRates.length > 0 && (
              <div>
                <h3 className="text-[13px] font-medium text-ink mb-1.5">Brakujące stawki</h3>
                <Table>
                  <thead>
                    <tr>
                      <Th>Stanowisko</Th>
                      <Th>Forma zatrudnienia</Th>
                      <Th className="text-right pr-4">Pracownicy</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.missingRates.map((m) => (
                      <tr key={`${m.position}:${m.employmentType}`}>
                        <Td>{m.position}</Td>
                        <Td>{contractLabel(m.employmentType)}</Td>
                        <Td className="text-right pr-4">{m.employeeIds.length}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </div>
        ) : null}
      </Card>

      {canEditRates && (
        <Card className="p-4">
          <h3 className="font-display font-bold text-[15px] text-navy mb-3">Stawki na stanowisku</h3>

          {ratesError && (
            <div role="alert" className="mb-3 text-sm text-warn border border-warn/30 bg-warn/[0.08] rounded-lg px-3.5 py-2.5">
              {ratesError}
            </div>
          )}

          {rates.length > 0 && (
            <Table>
              <thead>
                <tr>
                  <Th>Stanowisko</Th>
                  <Th>Forma zatrudnienia</Th>
                  <Th className="text-right">Stawka godzinowa</Th>
                  <Th>Waluta</Th>
                </tr>
              </thead>
              <tbody>
                {rates.map((r) => (
                  <tr key={r.id}>
                    <Td>{r.position}</Td>
                    <Td>{contractLabel(r.employmentType)}</Td>
                    <Td className="text-right">{formatMoney(r.hourlyRate, r.currency)}</Td>
                    <Td>{r.currency}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}

          <form onSubmit={submitRate} className="mt-4 flex items-end gap-3 flex-wrap">
            <Field label="Stanowisko" htmlFor="ratePosition" className="mb-0 w-[220px]">
              <Input
                id="ratePosition"
                value={rateForm.position}
                onChange={(e) => setRateForm((f) => ({ ...f, position: e.target.value }))}
                placeholder="np. Kierowca"
              />
            </Field>
            <Field label="Forma zatrudnienia" htmlFor="rateEmploymentType" className="mb-0 w-[180px]">
              <select
                id="rateEmploymentType"
                value={rateForm.employmentType}
                onChange={(e) => setRateForm((f) => ({ ...f, employmentType: e.target.value as EmploymentType }))}
                className={employeeSelectClass}
              >
                {EMPLOYMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {contractLabel(t)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Stawka / godz." htmlFor="rateHourly" className="mb-0 w-[140px]">
              <Input
                id="rateHourly"
                type="number"
                min={0}
                step="0.01"
                value={rateForm.hourlyRate}
                onChange={(e) => setRateForm((f) => ({ ...f, hourlyRate: e.target.value }))}
              />
            </Field>
            <Field label="Waluta" htmlFor="rateCurrency" className="mb-0 w-[100px]">
              <Input
                id="rateCurrency"
                value={rateForm.currency}
                onChange={(e) => setRateForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))}
              />
            </Field>
            <Button type="submit" className="h-11 px-4 text-sm" disabled={savingRate}>
              {savingRate ? 'Zapisywanie…' : 'Zapisz stawkę'}
            </Button>
          </form>

          {saveRateError && (
            <div role="alert" className="mt-3 text-sm text-warn border border-warn/30 bg-warn/[0.08] rounded-lg px-3.5 py-2.5">
              {saveRateError}
            </div>
          )}
          {saveRateOk && (
            <div role="status" className="mt-3 text-sm text-verified border border-verified/30 bg-verified/[0.06] rounded-lg px-3.5 py-2.5">
              Zapisano stawkę.
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
