'use client'

/**
 * Prowadzony przewodnik + autoplay „demo" — izolowany, lekki komponent.
 *
 * Zero zewnętrznych zależności (własny overlay/spotlight zamiast Shepherd.js), spójny wizualnie
 * z `components/ui/*`. Podświetla `target` bieżącego kroku, pokazuje dymek z tytułem i opisem,
 * daje Dalej/Wstecz/Zakończ oraz opcjonalny autoplay (auto-przejście co N sekund). Autoplay jest
 * wyłączony, gdy użytkownik preferuje mniej ruchu (`prefers-reduced-motion`). Dostępność: focus
 * trap w dymku, widoczny focus (globalny ring z globals.css), ESC zamyka.
 *
 * Wpięcie: wyrenderuj `<TourTrigger />` w topbarze; przycisk montuje `<Tour />` na żądanie.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { TOUR_STEPS, type TourStep } from './tour.data'
import { nextIndex, isLast } from './tour.logic'

const AUTOPLAY_MS = 6000
const SPOTLIGHT_PAD = 8

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

/** Uszanuj preferencję „mniej ruchu" — brak autoplaya, gdy użytkownik jej sobie życzy. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/** Zmierz element `target` bieżącego kroku (co krok + na resize/scroll). */
function useTargetRect(step: TourStep | undefined): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null)
  useEffect(() => {
    if (!step) return
    const measure = () => {
      let el: Element | null = null
      try {
        el = document.querySelector(step.target)
      } catch {
        el = null
      }
      if (!el) {
        setRect(null)
        return
      }
      const r = el.getBoundingClientRect()
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [step])
  return rect
}

export interface TourProps {
  /** Kroki do pokazania (domyślnie pełny zestaw M1–M3). */
  steps?: TourStep[]
  /** Wywoływane przy zamknięciu/ukończeniu — odmontuj komponent tutaj. */
  onClose: () => void
  /** Startowy autoplay (i tak stłumiony przy prefers-reduced-motion). */
  autoplay?: boolean
}

export function Tour({ steps = TOUR_STEPS, onClose, autoplay = false }: TourProps) {
  const [index, setIndex] = useState(0)
  const reducedMotion = usePrefersReducedMotion()
  const [playing, setPlaying] = useState(autoplay && !reducedMotion)
  const dialogRef = useRef<HTMLDivElement>(null)

  const step = steps[index]
  const rect = useTargetRect(step)
  const last = isLast(index, steps.length)

  const go = useCallback(
    (dir: 1 | -1) => setIndex((i) => nextIndex(i, steps.length, dir)),
    [steps.length],
  )

  const finish = useCallback(() => {
    setPlaying(false)
    onClose()
  }, [onClose])

  // Autoplay: przejdź dalej co N sekund; zatrzymaj się na ostatnim kroku. Nigdy nie startuje,
  // gdy użytkownik preferuje mniej ruchu.
  useEffect(() => {
    if (!playing || reducedMotion) return
    if (last) {
      setPlaying(false)
      return
    }
    const t = setTimeout(() => setIndex((i) => nextIndex(i, steps.length, 1)), AUTOPLAY_MS)
    return () => clearTimeout(t)
  }, [playing, reducedMotion, last, index, steps.length])

  // ESC zamyka; strzałki nawigują. Focus trap trzyma focus w dymku.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        finish()
      } else if (e.key === 'ArrowRight') {
        go(1)
      } else if (e.key === 'ArrowLeft') {
        go(-1)
      } else if (e.key === 'Tab') {
        const root = dialogRef.current
        if (!root) return
        const focusables = root.querySelectorAll<HTMLElement>(
          'button, [href], [tabindex]:not([tabindex="-1"])',
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const lastEl = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          lastEl.focus()
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [finish, go])

  // Po zmianie kroku przenieś focus do dymka (czytnik ekranu ogłasza nowy krok).
  useEffect(() => {
    dialogRef.current?.focus()
  }, [index])

  if (!step) return null

  // Dymek: pod spotlightem, a jeśli target jest nisko/niewidoczny — wyśrodkowany.
  const hasRect = rect && rect.width > 0 && rect.height > 0
  const tooltipStyle: React.CSSProperties = hasRect
    ? { top: Math.min(rect.top + rect.height + 14, (typeof window !== 'undefined' ? window.innerHeight : 800) - 220), left: Math.max(16, Math.min(rect.left, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 372)) }
    : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label="Przewodnik po HRobot">
      {/* Przyciemnienie tła + spotlight na target (obwódka wokół zmierzonego prostokąta). */}
      <div className="absolute inset-0 bg-navy/50" onClick={finish} aria-hidden="true" />
      {hasRect && (
        <div
          className="absolute rounded-lg ring-2 ring-accent pointer-events-none transition-[top,left,width,height] duration-200"
          style={{
            top: rect.top - SPOTLIGHT_PAD,
            left: rect.left - SPOTLIGHT_PAD,
            width: rect.width + SPOTLIGHT_PAD * 2,
            height: rect.height + SPOTLIGHT_PAD * 2,
            boxShadow: '0 0 0 9999px rgb(11 31 59 / 0.50)',
          }}
          aria-hidden="true"
        />
      )}

      {/* Dymek */}
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="absolute w-[356px] max-w-[calc(100vw-32px)] bg-card border border-line-strong rounded-lg shadow-lg p-5 outline-none"
        style={tooltipStyle}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-[10.5px] tracking-[.08em] uppercase text-accent-ink">
            Krok {index + 1} / {steps.length}
          </span>
          <button
            type="button"
            onClick={finish}
            aria-label="Zakończ przewodnik"
            className="grid place-items-center w-7 h-7 rounded-md text-muted hover:text-ink hover:bg-card-2"
          >
            <span aria-hidden="true" className="text-[16px] leading-none">
              ×
            </span>
          </button>
        </div>

        <h2 className="text-[16px] font-semibold text-ink tracking-tightish">{step.title}</h2>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{step.text}</p>

        {/* Pasek postępu */}
        <div className="mt-4 flex gap-1" aria-hidden="true">
          {steps.map((s, i) => (
            <span
              key={s.id}
              className={cn('h-1 flex-1 rounded-full', i <= index ? 'bg-accent' : 'bg-line')}
            />
          ))}
        </div>

        <div className="mt-4 flex items-center gap-2">
          {!reducedMotion && !last && (
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              className="inline-flex items-center h-9 px-3 rounded-sm text-[13px] font-medium text-muted border border-line-strong hover:bg-card-2"
              aria-pressed={playing}
            >
              {playing ? 'Pauza' : 'Autoplay'}
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => go(-1)}
              disabled={index === 0}
              className="inline-flex items-center h-9 px-3.5 rounded-sm text-[13px] font-semibold text-ink border border-line-strong hover:bg-card-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Wstecz
            </button>
            {last ? (
              <button
                type="button"
                onClick={finish}
                className="inline-flex items-center h-9 px-4 rounded-sm text-[13px] font-semibold text-white bg-accent border border-transparent hover:bg-accent-ink"
              >
                Zakończ
              </button>
            ) : (
              <button
                type="button"
                onClick={() => go(1)}
                className="inline-flex items-center h-9 px-4 rounded-sm text-[13px] font-semibold text-white bg-accent border border-transparent hover:bg-accent-ink"
              >
                Dalej
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export interface TourTriggerProps {
  className?: string
  /** Czy klik uruchamia od razu autoplay (demo bez rąk). */
  autoplay?: boolean
}

/** Mały przycisk „Przewodnik" do topbara — montuje `<Tour/>` na żądanie. */
export function TourTrigger({ className, autoplay = false }: TourTriggerProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex items-center gap-1.5 h-[34px] px-3 rounded-lg border border-line-strong bg-card text-[12.5px] font-medium text-muted hover:text-ink hover:bg-card-2 transition-colors',
          className,
        )}
      >
        <span aria-hidden="true">◎</span>
        Przewodnik
      </button>
      {open && <Tour onClose={() => setOpen(false)} autoplay={autoplay} />}
    </>
  )
}
