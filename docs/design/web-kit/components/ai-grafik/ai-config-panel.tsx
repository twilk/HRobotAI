'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { employeeSelectClass, mutationErrorMessage } from '@/lib/employee-profile'
import {
  aiGrafikApi,
  autonomyLabel,
  validateQuietHours,
  AUTONOMY_LEVELS,
  AiGrafikApiError,
  type AutonomyLevel,
} from '@/lib/ai-grafik'

/** Editable form state — all strings so the inputs stay controlled; parsed on submit. */
interface FormState {
  autonomyLevel: AutonomyLevel
  consentTtlHours: string
  quietHoursStart: string
  quietHoursEnd: string
}

/**
 * Tenant-wide AI scheduling policy editor. GETs the config on mount through the same-origin
 * /api/ai-grafik proxy (cookie-authenticated), then PATCHes changes back. No PII: the config is
 * autonomy/consent/quiet-hours policy, never personal data.
 */
export function AiConfigPanel() {
  const [form, setForm] = useState<FormState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Tied to the component's lifetime: the mount GET (and a later refresh) can resolve after unmount
  // (mirrors employees-screen.tsx's cancelledRef guard).
  const cancelledRef = useRef(false)
  useEffect(() => {
    cancelledRef.current = false
    return () => {
      cancelledRef.current = true
    }
  }, [])

  const loadConfig = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const cfg = await aiGrafikApi.getConfig()
      if (cancelledRef.current) return
      setForm({
        autonomyLevel: cfg.autonomyLevel,
        consentTtlHours: String(cfg.consentTtlHours),
        quietHoursStart: cfg.quietHoursStart ?? '',
        quietHoursEnd: cfg.quietHoursEnd ?? '',
      })
    } catch (err) {
      if (!cancelledRef.current) {
        setError(
          err instanceof AiGrafikApiError
            ? mutationErrorMessage(err.status)
            : 'Brak połączenia z serwerem. Spróbuj ponownie.',
        )
      }
    } finally {
      if (!cancelledRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  function patch(next: Partial<FormState>) {
    setSaved(false)
    setSaveError(null)
    setForm((prev) => (prev ? { ...prev, ...next } : prev))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    setSaveError(null)
    setSaved(false)

    const ttl = Number(form.consentTtlHours.trim())
    if (!Number.isInteger(ttl) || ttl < 1) {
      setSaveError('Ważność zgody musi być liczbą godzin (min. 1).')
      return
    }
    if (!validateQuietHours(form.quietHoursStart, form.quietHoursEnd)) {
      setSaveError('Cisza nocna: podaj oba pola w formacie GG:MM lub zostaw oba puste.')
      return
    }

    setSaving(true)
    try {
      const start = form.quietHoursStart.trim()
      const end = form.quietHoursEnd.trim()
      await aiGrafikApi.updateConfig({
        autonomyLevel: form.autonomyLevel,
        consentTtlHours: ttl,
        quietHoursStart: start === '' ? null : start,
        quietHoursEnd: end === '' ? null : end,
      })
      if (!cancelledRef.current) setSaved(true)
    } catch (err) {
      if (!cancelledRef.current) {
        setSaveError(
          err instanceof AiGrafikApiError
            ? mutationErrorMessage(err.status, { badRequest: 'Nieprawidłowe dane. Sprawdź formularz.' })
            : 'Brak połączenia z serwerem. Spróbuj ponownie.',
        )
      }
    } finally {
      if (!cancelledRef.current) setSaving(false)
    }
  }

  if (loading)
    return <div className="grid place-items-center py-24 text-muted text-sm">Ładowanie konfiguracji…</div>

  if (error)
    return (
      <div className="max-w-[720px] mx-auto rounded-lg border border-error/30 bg-error/[0.05] px-4 py-3 text-[13.5px] text-ink" role="alert">
        {error}{' '}
        <button type="button" onClick={loadConfig} className="underline hover:no-underline">
          Spróbuj ponownie
        </button>
      </div>
    )

  if (!form) return null

  return (
    <div className="max-w-[720px] mx-auto">
      <div className="mb-[22px]">
        <h1 className="font-display font-extrabold text-[26px] tracking-tightish text-navy leading-tight">
          AI Grafik Manager
        </h1>
        <p className="text-muted text-sm mt-1.5">
          Zasady autonomii, zgód i ciszy nocnej dla propozycji generowanych przez AI.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="rounded-lg border border-line-strong bg-card p-5">
        <Field label="Poziom autonomii" htmlFor="autonomyLevel" hint="Jak bardzo AI może działać samodzielnie.">
          <select
            id="autonomyLevel"
            value={form.autonomyLevel}
            onChange={(e) => patch({ autonomyLevel: e.target.value as AutonomyLevel })}
            className={employeeSelectClass}
          >
            {AUTONOMY_LEVELS.map((level) => (
              <option key={level} value={level}>
                {autonomyLabel(level)}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Ważność zgody (godziny)"
          htmlFor="consentTtlHours"
          hint="Po ilu godzinach prośba o zgodę pracownika wygasa."
        >
          <Input
            id="consentTtlHours"
            type="number"
            min={1}
            step={1}
            value={form.consentTtlHours}
            onChange={(e) => patch({ consentTtlHours: e.target.value })}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Cisza nocna — od" htmlFor="quietHoursStart" hint="Puste = wyłączone.">
            <Input
              id="quietHoursStart"
              type="time"
              value={form.quietHoursStart}
              onChange={(e) => patch({ quietHoursStart: e.target.value })}
            />
          </Field>
          <Field label="Cisza nocna — do" htmlFor="quietHoursEnd" hint="Puste = wyłączone.">
            <Input
              id="quietHoursEnd"
              type="time"
              value={form.quietHoursEnd}
              onChange={(e) => patch({ quietHoursEnd: e.target.value })}
            />
          </Field>
        </div>

        {saveError ? (
          <div className="mb-4 rounded-lg border border-error/30 bg-error/[0.05] px-4 py-3 text-[13.5px] text-ink" role="alert">
            {saveError}
          </div>
        ) : null}
        {saved ? (
          <div className="mb-4 rounded-lg border border-verified/30 bg-verified/[0.06] px-4 py-3 text-[13.5px] text-ink" role="status">
            Zapisano konfigurację.
          </div>
        ) : null}

        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? 'Zapisywanie…' : 'Zapisz konfigurację'}
          </Button>
        </div>
      </form>
    </div>
  )
}
