'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { LEAVE_TYPES, leaveTypeLabel, validateLeaveRange } from '@/lib/wnioski'
import { groupByDay, todayIso, type DayGroup, type WeekShift } from '@/lib/moj-tydzien'

/**
 * The employee's week on a phone. One column, large targets, two answers only: when am I working,
 * and can I ask for time off.
 *
 * TOUCH TARGETS ARE 44px MINIMUM (`min-h-[44px]`), which is the smallest reliably tappable control
 * on a phone held one-handed next to a car. Every interactive element here meets it; the desktop
 * screens do not, which is precisely why they are not this route.
 */

interface LeaveRow {
  id: string
  startDate: string
  endDate: string
  type: string
  status: string
}

interface MeResponse {
  firstName?: string
  etat?: string | number
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

/**
 * Like {@link getJson} but treats 404 as "there is no such record", not as a failure.
 *
 * An ADMIN_KLIENTA or HR account often has no `Employee` row — it is a login, not a person on the
 * roster (the demo admin is exactly this shape, and known-limitations.md already records it). Before
 * this, such an account got "Brak połączenia. Sprawdź internet." on a working connection, which is
 * both wrong and the sort of message that sends somebody debugging their wifi.
 */
async function getJsonOrNull<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { cache: 'no-store' })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Oczekuje',
  APPROVED: 'Zatwierdzony',
  REJECTED: 'Odrzucony',
  CANCELLED: 'Anulowany',
}

const STATUS_TONE: Record<string, string> = {
  PENDING: 'bg-warn/10 text-warn',
  APPROVED: 'bg-verified/10 text-verified',
  REJECTED: 'bg-error/10 text-error',
  CANCELLED: 'bg-muted-2/10 text-muted-2',
}

export function MobileWeek() {
  const [days, setDays] = useState<DayGroup[] | null>(null)
  const [leaves, setLeaves] = useState<LeaveRow[]>([])
  const [me, setMe] = useState<MeResponse | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const cancelled = useRef(false)

  const load = useCallback(async () => {
    try {
      const today = todayIso()
      const [meRes, shifts, leaveRows] = await Promise.all([
        getJsonOrNull<MeResponse>('/api/employees/me'),
        getJson<WeekShift[]>('/api/grafik/shifts'),
        getJson<LeaveRow[]>('/api/wnioski'),
      ])
      if (cancelled.current) return
      setMe(meRes)
      setDays(groupByDay(Array.isArray(shifts) ? shifts : [], today))
      setLeaves(Array.isArray(leaveRows) ? leaveRows : [])
      setError(null)
    } catch {
      if (!cancelled.current) setError('Brak połączenia. Sprawdź internet i odśwież.')
    } finally {
      if (!cancelled.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    cancelled.current = false
    void load()
    return () => {
      cancelled.current = true
    }
  }, [load])

  if (loading) return <p className="py-16 text-center text-sm text-muted">Ładowanie…</p>

  if (error) {
    return (
      <div role="alert" className="rounded-lg border border-warn/30 bg-warn/[0.08] px-3.5 py-3 text-sm text-warn">
        {error}
      </div>
    )
  }

  const hours = (days ?? []).flatMap((d) => d.shifts).length

  return (
    <div className="space-y-6">
      <header>
        {/* The heading renders unconditionally. It used to depend on `me`, so an account with no
            Employee row produced a page with no heading at all — which is also what broke the
            evidence capture, since its acceptance check is "a heading is visible". */}
        <h1 className="font-display text-2xl font-extrabold tracking-tighter2 text-navy">
          {me?.firstName ? `Cześć, ${me.firstName}` : 'Twój tydzień'}
        </h1>
        <p className="mt-1 text-[13px] text-muted">
          {me === null
            ? 'To konto nie ma kartoteki pracownika, więc nie ma własnego grafiku ani wniosków.'
            : hours === 0
              ? 'W tym tygodniu nie masz zaplanowanych zmian.'
              : `Masz ${hours} zaplanowanych zmian.`}
        </p>
      </header>

      <section aria-label="Grafik na ten tydzień" className="space-y-2">
        {(days ?? []).map((day) => (
          <article
            key={day.date}
            className={`rounded-lg border p-3.5 ${day.isToday ? 'border-accent-ink bg-accent-ink/[0.04]' : 'border-line bg-card'}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[13px] font-semibold text-navy">
                {day.weekday}
                {day.isToday ? <span className="ml-1.5 text-[11px] font-normal text-accent-ink">dziś</span> : null}
              </h2>
              <span className="text-[12px] tabular-nums text-muted-2">{day.dayLabel}</span>
            </div>

            {day.shifts.length === 0 ? (
              // An empty day is stated, never omitted: "wolne" is as useful as a start time.
              <p className="mt-1.5 text-[13px] text-muted-2">Wolne</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {day.shifts.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 font-display text-lg font-bold tabular-nums text-navy">
                    {s.start}
                    <span className="text-muted-2">–</span>
                    {s.end}
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </section>

      <LeaveRequestForm onSubmitted={load} />

      <section aria-label="Twoje wnioski" className="space-y-2">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted-2">Twoje wnioski</h2>
        {leaves.length === 0 ? (
          <p className="text-[13px] text-muted-2">Nie masz jeszcze żadnych wniosków.</p>
        ) : (
          <ul className="space-y-2">
            {leaves.slice(0, 5).map((l) => (
              <li key={l.id} className="rounded-lg border border-line bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] text-navy">{leaveTypeLabel(l.type)}</span>
                  <span className={`rounded-sm px-1.5 py-0.5 text-[11px] ${STATUS_TONE[l.status] ?? 'bg-muted-2/10 text-muted-2'}`}>
                    {STATUS_LABEL[l.status] ?? l.status}
                  </span>
                </div>
                <p className="mt-1 text-[12px] tabular-nums text-muted-2">
                  {l.startDate.slice(0, 10)} – {l.endDate.slice(0, 10)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/** The second of the two things a shift worker needs. Native date inputs — the phone's own picker. */
function LeaveRequestForm({ onSubmitted }: { onSubmitted: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [type, setType] = useState<string>(LEAVE_TYPES[0] as string)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)

  const rangeValid = startDate !== '' && endDate !== '' && validateLeaveRange(startDate, endDate)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!rangeValid || busy) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/wnioski', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ startDate, endDate, type }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setMessage({ tone: 'ok', text: 'Wniosek wysłany.' })
      setStartDate('')
      setEndDate('')
      setOpen(false)
      await onSubmitted()
    } catch {
      setMessage({ tone: 'err', text: 'Nie udało się wysłać. Spróbuj ponownie.' })
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="min-h-[44px] w-full rounded-lg bg-navy px-4 text-[15px] font-semibold text-white"
        >
          Złóż wniosek o urlop
        </button>
        {message ? (
          <p role="status" className={`text-[13px] ${message.tone === 'ok' ? 'text-verified' : 'text-error'}`}>
            {message.text}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-line bg-card p-3.5">
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted-2">Wniosek o urlop</h2>

      <label className="block text-[13px] text-muted">
        Od
        <input
          type="date"
          required
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="mt-1 min-h-[44px] w-full rounded-sm border border-line px-3 text-[15px] text-navy"
        />
      </label>

      <label className="block text-[13px] text-muted">
        Do
        <input
          type="date"
          required
          value={endDate}
          min={startDate || undefined}
          onChange={(e) => setEndDate(e.target.value)}
          className="mt-1 min-h-[44px] w-full rounded-sm border border-line px-3 text-[15px] text-navy"
        />
      </label>

      <label className="block text-[13px] text-muted">
        Rodzaj
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="mt-1 min-h-[44px] w-full rounded-sm border border-line px-3 text-[15px] text-navy"
        >
          {LEAVE_TYPES.map((t) => (
            <option key={t} value={t}>
              {leaveTypeLabel(t)}
            </option>
          ))}
        </select>
      </label>

      {startDate !== '' && endDate !== '' && !rangeValid ? (
        <p role="alert" className="text-[13px] text-error">
          Data „do” nie może być wcześniejsza niż „od”.
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!rangeValid || busy}
          className="min-h-[44px] flex-1 rounded-lg bg-navy px-4 text-[15px] font-semibold text-white disabled:opacity-40"
        >
          {busy ? 'Wysyłanie…' : 'Wyślij'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-[44px] rounded-lg border border-line px-4 text-[15px] text-muted"
        >
          Anuluj
        </button>
      </div>

      {message ? (
        <p role="status" className={`text-[13px] ${message.tone === 'ok' ? 'text-verified' : 'text-error'}`}>
          {message.text}
        </p>
      ) : null}
    </form>
  )
}
