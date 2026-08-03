'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BarChart, ChartLegend, ColumnChart, RatioGauge, Sparkline, StackedBar } from '@/components/analityk/charts'
import { IconCalendar, IconRequests, IconSparkles, IconUsers } from '@/components/icons'
import {
  analitykApi,
  absenceTone,
  defaultRange,
  deltaTone,
  formatDecisionTime,
  formatDelta,
  formatDeltaPunkty,
  formatHours,
  formatNumber,
  formatPercent,
  leaveTypeLabel,
  monthLabel,
  monthToDateRange,
  podsumowanieToCsv,
  shortId,
  TONE_TEXT,
  yearToDateRange,
  type AnalitykQuery,
  type PodsumowanieResult,
  type PorownanieResult,
  type UnitBreakdown,
} from '@/lib/analityk'

/**
 * The Analityk HR dashboard (M3). A CLIENT component: it loads the summary + the period-over-period
 * comparison from the same-origin proxy and renders KPI tiles and charts.
 *
 * It computes NOTHING — every figure, rate and ranking arrives already aggregated and already
 * RBAC-scoped from the tenant-runtime `analityk` controller. A MANAGER simply receives a narrower
 * payload than HR; there is no client-side filtering standing in for authorization. Payloads carry
 * IDs and numbers only, so employee-level rows are labelled by a short ID handle rather than a name.
 */

type Preset = '30d' | 'mtd' | 'ytd' | 'custom'

const PRESET_LABEL: Record<Exclude<Preset, 'custom'>, string> = {
  '30d': 'Ostatnie 30 dni',
  mtd: 'Ten miesiąc',
  ytd: 'Ten rok',
}

function SectionHeading({ icon: Icon, children, hint }: { icon: typeof IconUsers; children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-2">
      <h2 className="flex items-center gap-2 text-base font-semibold tracking-tightish text-navy">
        <Icon className="h-[17px] w-[17px] text-accent-ink" strokeWidth={1.7} />
        {children}
      </h2>
      {hint ? <span className="text-[12px] text-muted-2">{hint}</span> : null}
    </div>
  )
}

function Panel({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-card p-4 ${className}`}>
      <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-muted-2">{title}</h3>
      {children}
    </section>
  )
}

/** One headline KPI: the value, what it is, and how it moved against the previous window. */
function KpiTile({
  label,
  value,
  delta,
  deltaLabel,
  valueTone = 'text-navy',
}: {
  label: string
  value: string
  delta?: string
  deltaLabel?: string
  valueTone?: string
}) {
  return (
    <div className="rounded-lg border border-line bg-card p-3.5">
      <p className="text-[11.5px] uppercase tracking-wide text-muted-2">{label}</p>
      <p className={`mt-1 font-display text-2xl font-extrabold tracking-tighter2 tabular-nums ${valueTone}`}>{value}</p>
      {delta ? (
        <p className={`mt-0.5 text-[12px] tabular-nums ${deltaLabel ?? 'text-muted'}`}>
          {delta} <span className="text-muted-2">wobec poprz. okresu</span>
        </p>
      ) : null}
    </div>
  )
}

export function AnalitykDashboard() {
  const [query, setQuery] = useState<AnalitykQuery>(() => defaultRange())
  const [preset, setPreset] = useState<Preset>('30d')
  const [data, setData] = useState<PodsumowanieResult | null>(null)
  const [porownanie, setPorownanie] = useState<PorownanieResult | null>(null)
  const [units, setUnits] = useState<UnitBreakdown[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const [summary, compare] = await Promise.all([
          analitykApi.getPodsumowanie(query),
          // Best-effort: the comparison is a nicety, so a failure here must not blank the dashboard.
          analitykApi.getPorownanie(query).catch(() => null),
        ])
        if (cancelledRef.current) return
        setData(summary)
        setPorownanie(compare)
        // Remember the full unit list from an UNFILTERED load so narrowing to one unit does not
        // collapse the filter's own options to that single unit.
        if (!query.unitId) setUnits(summary.zatrudnienie.wgJednostek)
        setLoading(false)
      } catch (e) {
        if (cancelledRef.current) return
        setError(e instanceof Error ? e.message : 'Nie udało się wczytać analityki.')
        setLoading(false)
      }
    })()

    return () => {
      cancelledRef.current = true
    }
  }, [query])

  const applyPreset = useCallback((next: Exclude<Preset, 'custom'>) => {
    setPreset(next)
    const range = next === '30d' ? defaultRange() : next === 'mtd' ? monthToDateRange() : yearToDateRange()
    setQuery((q) => ({ ...range, unitId: q.unitId }))
  }, [])

  const exportCsv = useCallback(() => {
    if (!data) return
    // A BOM keeps Polish diacritics intact when the file is opened in Excel.
    const blob = new Blob([`﻿${podsumowanieToCsv(data)}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `analityk-hr_${data.meta.od}_${data.meta.do}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [data])

  const uwagi = useMemo(() => {
    if (!data) return []
    const all = [
      ...data.meta.uwagi,
      ...data.czasPracy.meta.uwagi,
      ...data.urlopy.meta.uwagi,
      ...data.wnioski.meta.uwagi,
      ...data.zatrudnienie.meta.uwagi,
      ...data.absencje.meta.uwagi,
    ]
    return [...new Set(all)]
  }, [data])

  return (
    <div className="space-y-6">
      {/* --- controls ------------------------------------------------------------------------ */}
      <section className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-lg border border-line bg-card-2 p-3.5">
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(PRESET_LABEL) as Exclude<Preset, 'custom'>[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => applyPreset(p)}
              aria-pressed={preset === p}
              className={
                'rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors ' +
                (preset === p
                  ? 'border-accent bg-accent/10 text-accent-ink'
                  : 'border-line bg-card text-muted hover:bg-card-2 hover:text-navy')
              }
            >
              {PRESET_LABEL[p]}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
          <span>Od</span>
          <input
            type="date"
            value={query.od}
            max={query.do}
            onChange={(e) => {
              setPreset('custom')
              setQuery((q) => ({ ...q, od: e.target.value }))
            }}
            className="rounded-md border border-line bg-card px-2 py-1 text-[12.5px] text-navy"
          />
        </label>
        <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
          <span>Do</span>
          <input
            type="date"
            value={query.do}
            min={query.od}
            onChange={(e) => {
              setPreset('custom')
              setQuery((q) => ({ ...q, do: e.target.value }))
            }}
            className="rounded-md border border-line bg-card px-2 py-1 text-[12.5px] text-navy"
          />
        </label>

        {units.length > 1 ? (
          <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
            <span>Jednostka</span>
            <select
              value={query.unitId ?? ''}
              onChange={(e) => setQuery((q) => ({ ...q, unitId: e.target.value || undefined }))}
              className="rounded-md border border-line bg-card px-2 py-1 text-[12.5px] text-navy"
            >
              <option value="">Wszystkie</option>
              {units.map((u) => (
                <option key={u.unitId} value={u.unitId}>
                  {u.nazwa}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <button
          type="button"
          onClick={exportCsv}
          disabled={!data}
          className="ml-auto rounded-md border border-line bg-card px-3 py-1.5 text-[12.5px] font-medium text-navy transition-colors hover:bg-card-2 disabled:opacity-50"
        >
          Eksport CSV
        </button>
      </section>

      {loading ? <p className="text-sm text-muted">Ładowanie analityki…</p> : null}
      {error ? <p className="rounded-md border border-error/30 bg-error/5 px-4 py-3 text-sm text-error">{error}</p> : null}

      {data && !loading ? (
        <>
          {/* --- KPI row --------------------------------------------------------------------- */}
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <KpiTile
              label="Stan zatrudnienia"
              value={`${data.zatrudnienie.stanNaKoniec} os.`}
              delta={porownanie ? formatDelta(porownanie.zmiana.stanZatrudnienia) : undefined}
              deltaLabel={porownanie ? TONE_TEXT[deltaTone(porownanie.zmiana.stanZatrudnienia)] : undefined}
            />
            <KpiTile
              label="Wskaźnik absencji"
              value={formatPercent(data.absencje.wskaznik)}
              valueTone={TONE_TEXT[absenceTone(data.absencje.wskaznik)]}
              delta={porownanie ? formatDeltaPunkty(porownanie.zmiana.wskaznikAbsencji) : undefined}
              deltaLabel={porownanie ? TONE_TEXT[deltaTone(porownanie.zmiana.wskaznikAbsencji, true)] : undefined}
            />
            <KpiTile
              label="Suma godzin"
              value={formatHours(data.czasPracy.sumaGodzin, 0)}
              delta={porownanie ? formatDelta(porownanie.zmiana.sumaGodzin) : undefined}
              deltaLabel={porownanie ? TONE_TEXT[deltaTone(porownanie.zmiana.sumaGodzin)] : undefined}
            />
            <KpiTile
              label="Nadgodziny"
              value={formatHours(data.czasPracy.nadgodziny, 0)}
              delta={porownanie ? formatDelta(porownanie.zmiana.nadgodziny) : undefined}
              deltaLabel={porownanie ? TONE_TEXT[deltaTone(porownanie.zmiana.nadgodziny, true)] : undefined}
            />
            <KpiTile
              label="Wnioski w toku"
              value={`${data.wnioski.wToku} szt.`}
              delta={porownanie ? formatDelta(porownanie.zmiana.wnioskiWToku) : undefined}
              deltaLabel={porownanie ? TONE_TEXT[deltaTone(porownanie.zmiana.wnioskiWToku, true)] : undefined}
            />
            <KpiTile
              label="Mediana czasu do decyzji"
              value={formatDecisionTime(data.wnioski.medianaGodzinDoDecyzji)}
              delta={porownanie ? formatDelta(porownanie.zmiana.medianaGodzinDoDecyzji, 1) : undefined}
              deltaLabel={porownanie ? TONE_TEXT[deltaTone(porownanie.zmiana.medianaGodzinDoDecyzji, true)] : undefined}
            />
          </section>

          {/* --- Zatrudnienie ---------------------------------------------------------------- */}
          <section>
            <SectionHeading icon={IconUsers} hint={`${data.meta.dniRobocze} dni roboczych w zakresie`}>
              Stan zatrudnienia
            </SectionHeading>
            <div className="grid gap-3 lg:grid-cols-2">
              <Panel title="Podział wg jednostek">
                <BarChart
                  data={data.zatrudnienie.wgJednostek.map((u) => ({ label: u.nazwa, value: u.liczba }))}
                  valueFormat={(v) => `${v} os.`}
                  emptyLabel="Brak pracowników w tym zakresie."
                />
              </Panel>
              <Panel title="Podział wg lokalizacji (wg grafiku)">
                <BarChart
                  data={data.zatrudnienie.wgLokalizacji.map((l) => ({ label: l.nazwa, value: l.liczba }))}
                  valueFormat={(v) => `${v} os.`}
                  barClass="bg-navy-700"
                  emptyLabel="Brak zaplanowanych zmian w tym zakresie."
                />
              </Panel>
              <Panel title="Dynamika: przyjęcia i odejścia" className="lg:col-span-2">
                <ColumnChart
                  categories={data.zatrudnienie.dynamika.map((d) => monthLabel(d.miesiac))}
                  series={[
                    { label: 'Przyjęcia', values: data.zatrudnienie.dynamika.map((d) => d.przyjecia) },
                    { label: 'Odejścia', values: data.zatrudnienie.dynamika.map((d) => d.odejscia) },
                  ]}
                />
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-4">
                  <div>
                    <dt className="text-muted-2">Przyjęcia</dt>
                    <dd className="font-semibold tabular-nums text-navy">{data.zatrudnienie.przyjecia}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-2">Odejścia</dt>
                    <dd className="font-semibold tabular-nums text-navy">{data.zatrudnienie.odejscia}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-2">Zmiana netto</dt>
                    <dd className={`font-semibold tabular-nums ${TONE_TEXT[deltaTone(data.zatrudnienie.zmiana)]}`}>
                      {formatDelta(data.zatrudnienie.zmiana)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-2">Rotacja</dt>
                    <dd className="font-semibold tabular-nums text-navy">{formatPercent(data.zatrudnienie.rotacja)}</dd>
                  </div>
                </dl>
              </Panel>
            </div>
          </section>

          {/* --- Absencje -------------------------------------------------------------------- */}
          <section>
            <SectionHeading icon={IconCalendar} hint={`${data.absencje.dniNieobecnosci} z ${data.absencje.dniRoboczeLacznie} dni roboczych`}>
              Absencje
            </SectionHeading>
            <div className="grid gap-3 lg:grid-cols-2">
              <Panel title="Rozbicie wg typu wniosku">
                <StackedBar
                  segments={data.absencje.wgTypu.map((t) => ({ label: leaveTypeLabel(t.typ), value: t.dni }))}
                  emptyLabel="Brak zatwierdzonych nieobecności w tym zakresie."
                />
              </Panel>
              <Panel title="Wskaźnik absencji wg jednostek">
                <BarChart
                  data={data.absencje.wgJednostek.map((u) => ({
                    label: u.nazwa,
                    value: u.wskaznik ?? 0,
                    hint: `${u.dni}/${u.dniRobocze} dni`,
                  }))}
                  valueFormat={(v) => formatPercent(v)}
                  barClass="bg-warn"
                  emptyLabel="Brak danych o jednostkach."
                />
              </Panel>
            </div>
          </section>

          {/* --- Czas pracy ------------------------------------------------------------------ */}
          <section>
            <SectionHeading icon={IconCalendar} hint={`${data.czasPracy.liczbaZmian} zmian, ${data.czasPracy.osobodni} osobodni`}>
              Czas pracy
            </SectionHeading>
            <div className="grid gap-3 lg:grid-cols-2">
              <Panel title="Godziny wobec normy">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
                  <div>
                    <dt className="text-muted-2">Suma godzin</dt>
                    <dd className="font-semibold tabular-nums text-navy">{formatHours(data.czasPracy.sumaGodzin)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-2">Norma</dt>
                    <dd className="font-semibold tabular-nums text-navy">{formatHours(data.czasPracy.normaGodzin)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-2">Nadgodziny</dt>
                    <dd className="font-semibold tabular-nums text-warn">{formatHours(data.czasPracy.nadgodziny)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-2">Niedobór</dt>
                    <dd className="font-semibold tabular-nums text-muted">{formatHours(data.czasPracy.niedobor)}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-muted-2">Średnia dzienna</dt>
                    <dd className="font-semibold tabular-nums text-navy">{formatHours(data.czasPracy.sredniaDzienna)}</dd>
                  </div>
                </dl>
                <div className="mt-3">
                  <ChartLegend items={['Godziny przepracowane', 'Nadgodziny']} />
                </div>
              </Panel>
              <Panel title="Godziny wg jednostek">
                <BarChart
                  data={data.czasPracy.wgJednostek.map((u) => ({
                    label: u.nazwa,
                    value: u.godziny,
                    hint: u.nadgodziny > 0 ? `+${formatNumber(u.nadgodziny)} nadg.` : undefined,
                  }))}
                  valueFormat={(v) => formatHours(v, 0)}
                  emptyLabel="Brak zmian w tym zakresie."
                />
              </Panel>
              {data.czasPracy.topNadgodziny.length > 0 ? (
                <Panel title="Najwięcej nadgodzin" className="lg:col-span-2">
                  <BarChart
                    data={data.czasPracy.topNadgodziny.map((e) => ({ label: shortId(e.employeeId), value: e.nadgodziny }))}
                    valueFormat={(v) => formatHours(v)}
                    barClass="bg-warn"
                  />
                  <p className="mt-2 text-[11.5px] text-muted-2">
                    Identyfikatory zamiast nazwisk — moduł analityczny nie przetwarza danych osobowych.
                  </p>
                </Panel>
              ) : null}
            </div>
          </section>

          {/* --- Urlopy ---------------------------------------------------------------------- */}
          <section>
            <SectionHeading icon={IconSparkles} hint={`rok ${data.urlopy.rok}, wymiar ${data.urlopy.wymiarDni} dni`}>
              Wykorzystanie urlopów
            </SectionHeading>
            <div className="grid gap-3 lg:grid-cols-2">
              <Panel title="Wykorzystanie wymiaru">
                <p className="font-display text-2xl font-extrabold tracking-tighter2 tabular-nums text-navy">
                  {formatPercent(data.urlopy.wskaznikWykorzystania)}
                </p>
                <div className="mt-2">
                  <RatioGauge
                    value={data.urlopy.wskaznikWykorzystania}
                    label={`Wykorzystanie urlopu: ${formatPercent(data.urlopy.wskaznikWykorzystania)}`}
                  />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px]">
                  <div>
                    <dt className="text-muted-2">Wykorzystane dni</dt>
                    <dd className="font-semibold tabular-nums text-navy">{data.urlopy.wykorzystaneDni}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-2">Średnie saldo</dt>
                    <dd className="font-semibold tabular-nums text-navy">{formatNumber(data.urlopy.srednieSaldo)} dni</dd>
                  </div>
                </dl>
              </Panel>
              <Panel title="Rozkład salda urlopowego">
                <Sparkline
                  values={data.urlopy.rozkladSalda.map((b) => b.liczba)}
                  label="Rozkład salda urlopowego wg przedziałów"
                />
                <div className="mt-1 flex justify-between text-[11px] text-muted-2">
                  {data.urlopy.rozkladSalda.map((b) => (
                    <span key={b.przedzial}>{b.przedzial}</span>
                  ))}
                </div>
                <p className="mt-2 text-[11.5px] text-muted-2">Liczba pracowników wg pozostałych dni urlopu.</p>
              </Panel>
              <Panel title="Ryzyko przepadnięcia dni" className="lg:col-span-2">
                {data.urlopy.ryzykoPrzepadniecia.length === 0 ? (
                  <p className="rounded-md border border-dashed border-line bg-card-2 px-3 py-4 text-center text-[12.5px] text-muted-2">
                    Brak zagrożonych sald w tym okresie — sygnalizowane dopiero w IV kwartale.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[420px] text-left">
                      <thead>
                        <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted-2">
                          <th className="px-2 py-1.5 font-medium">Pracownik</th>
                          <th className="px-2 py-1.5 text-right font-medium">Pozostało</th>
                          <th className="px-2 py-1.5 text-right font-medium">Wykorzystano</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {data.urlopy.ryzykoPrzepadniecia.map((r) => (
                          <tr key={r.employeeId} className="text-[13px]">
                            <td className="px-2 py-1.5 font-medium text-navy">{shortId(r.employeeId)}</td>
                            <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-warn">{r.saldo} dni</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-muted">{r.wykorzystane} dni</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </div>
          </section>

          {/* --- Wnioski --------------------------------------------------------------------- */}
          <section>
            <SectionHeading icon={IconRequests} hint={`${data.wnioski.zlozone} złożonych w zakresie`}>
              Wnioski
            </SectionHeading>
            <div className="grid gap-3 lg:grid-cols-2">
              <Panel title="Rozstrzygnięcia">
                <StackedBar
                  segments={[
                    { label: 'Zaakceptowane', value: data.wnioski.zaakceptowane },
                    { label: 'Odrzucone', value: data.wnioski.odrzucone },
                    { label: 'Anulowane', value: data.wnioski.anulowane },
                  ]}
                  emptyLabel="Brak rozstrzygniętych wniosków w tym zakresie."
                />
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px]">
                  <div>
                    <dt className="text-muted-2">Odsetek odrzuceń</dt>
                    <dd className="font-semibold tabular-nums text-navy">{formatPercent(data.wnioski.odsetekOdrzucen)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-2">Mediana do decyzji</dt>
                    <dd className="font-semibold tabular-nums text-navy">
                      {formatDecisionTime(data.wnioski.medianaGodzinDoDecyzji)}
                    </dd>
                  </div>
                </dl>
              </Panel>
              <Panel title="Wąskie gardła akceptacji">
                {data.wnioski.waskieGardla.length === 0 ? (
                  <p className="rounded-md border border-dashed border-line bg-card-2 px-3 py-4 text-center text-[12.5px] text-muted-2">
                    Brak zaległych wniosków — żadna kolejka nie czeka.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {data.wnioski.waskieGardla.map((b) => (
                      <li key={b.unitId} className="flex items-baseline justify-between gap-3 border-b border-line pb-2 last:border-0 last:pb-0">
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium text-navy">{b.nazwa}</span>
                          <span className="block text-[11.5px] text-muted-2">
                            {b.managerUserId ? `Akceptujący: ${shortId(b.managerUserId)}` : 'Brak przypisanego kierownika'}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-[13px] font-semibold tabular-nums text-navy">{b.wToku} w toku</span>
                          <span className={`block text-[11.5px] tabular-nums ${b.najstarszyWiekDni > 14 ? 'text-error' : 'text-muted-2'}`}>
                            najstarszy: {b.najstarszyWiekDni} dni
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              {data.wnioski.wgTypu.length > 0 ? (
                <Panel title="Wnioski wg typu" className="lg:col-span-2">
                  <BarChart
                    data={data.wnioski.wgTypu.map((t) => ({ label: leaveTypeLabel(t.typ), value: t.liczba }))}
                    valueFormat={(v) => `${v} szt.`}
                  />
                </Panel>
              ) : null}
            </div>
          </section>

          {/* --- caveats --------------------------------------------------------------------- */}
          {uwagi.length > 0 ? (
            <section className="rounded-lg border border-line bg-card-2 p-4">
              <h3 className="text-[12.5px] font-semibold uppercase tracking-wide text-muted-2">Jak liczone są te wskaźniki</h3>
              <ul className="mt-2 space-y-1">
                {uwagi.map((u) => (
                  <li key={u} className="flex gap-2 text-[12.5px] text-muted">
                    <span aria-hidden className="text-muted-2">
                      •
                    </span>
                    {u}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
