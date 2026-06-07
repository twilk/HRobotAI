'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { usePathname } from 'next/navigation'
import toast from 'react-hot-toast'
import type { Tour } from 'shepherd.js'
import { resolveSpace } from '@/lib/guide/registry'
import { isDisabled as storeIsDisabled, isVisited, markVisited, setDisabled } from '@/lib/guide/store'
import type { GuideContextValue, GuideSpaceId, JourneyId } from '@/lib/guide/types'

// ─── Space step loaders ────────────────────────────────────────────────────────

async function loadSteps(spaceId: GuideSpaceId, tour: Tour) {
  switch (spaceId) {
    case 'dashboard': {
      const { dashboardSteps } = await import('@/lib/guide/spaces/dashboard')
      return dashboardSteps(tour)
    }
    case 'pracownicy': {
      const { pracownicySteps } = await import('@/lib/guide/spaces/pracownicy')
      return pracownicySteps(tour)
    }
    case 'pracownicy-id': {
      const { pracownicyIdSteps } = await import('@/lib/guide/spaces/pracownicy-id')
      return pracownicyIdSteps(tour)
    }
    case 'grafik': {
      const { grafikSteps } = await import('@/lib/guide/spaces/grafik')
      return grafikSteps(tour)
    }
    case 'wnioski': {
      const { wnioskiSteps } = await import('@/lib/guide/spaces/wnioski')
      return wnioskiSteps(tour)
    }
    case 'dostepy': {
      const { dostepySteps } = await import('@/lib/guide/spaces/dostepy')
      return dostepySteps(tour)
    }
    case 'ustawienia': {
      const { ustawieniaSteps } = await import('@/lib/guide/spaces/ustawienia')
      return ustawieniaSteps(tour)
    }
    case 'ustawienia-placowki': {
      const { ustawieniaPlacowkiSteps } = await import('@/lib/guide/spaces/ustawienia-placowki')
      return ustawieniaPlacowkiSteps(tour)
    }
    case 'ustawienia-uzytkownicy': {
      const { ustawieniaUzytkownicySteps } = await import('@/lib/guide/spaces/ustawienia-uzytkownicy')
      return ustawieniaUzytkownicySteps(tour)
    }
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

export const GuideContext = createContext<GuideContextValue>({
  startTour: () => {},
  startJourney: () => {},
  isDisabled: false,
  toggleDisabled: () => {},
  activeSpaceId: null,
})

export function useGuide(): GuideContextValue {
  return useContext(GuideContext)
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function GuideProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const activeSpaceId = resolveSpace(pathname)
  const [disabled, setDisabledState] = useState<boolean>(() => storeIsDisabled())
  const tourRef = useRef<Tour | null>(null)

  const cancelActiveTour = useCallback(() => {
    if (tourRef.current) {
      try { tourRef.current.cancel() } catch { /* ignore */ }
      tourRef.current = null
    }
  }, [])

  const startTour = useCallback(async (spaceId?: GuideSpaceId) => {
    const id = spaceId ?? activeSpaceId
    if (!id) return

    cancelActiveTour()

    const { createTour } = await import('@/lib/guide/shepherd')
    const tour = await createTour(id)
    tourRef.current = tour

    const steps = await loadSteps(id, tour)
    tour.addSteps(steps)

    tour.on('cancel', () => {
      tourRef.current = null
      toast('Przewodnik zamknięty. Kliknij ? by uruchomić ponownie.', {
        duration: 3500,
        icon: '💡',
      })
    })

    tour.on('complete', () => {
      tourRef.current = null
      toast('Gotowe! Możesz zawsze wrócić klikając ?.', {
        duration: 3000,
        icon: '✅',
      })
    })

    tour.start()
    markVisited(id)
  }, [activeSpaceId, cancelActiveTour])

  const startJourney = useCallback((_journeyId: JourneyId) => {
    // Journey support: v2 — placeholder
    console.log('[guide] journey not yet implemented:', _journeyId)
  }, [])

  const toggleDisabled = useCallback(() => {
    const next = !disabled
    setDisabled(next)
    setDisabledState(next)
  }, [disabled])

  // Auto-launch on first visit
  useEffect(() => {
    if (!activeSpaceId) return
    if (disabled) return
    if (isVisited(activeSpaceId)) return

    const timer = setTimeout(() => {
      startTour(activeSpaceId)
    }, 1200)

    return () => clearTimeout(timer)
  }, [activeSpaceId, disabled, startTour])

  // Cancel tour on route change
  useEffect(() => {
    cancelActiveTour()
  }, [pathname, cancelActiveTour])

  return (
    <GuideContext.Provider
      value={{ startTour, startJourney, isDisabled: disabled, toggleDisabled, activeSpaceId }}
    >
      {children}
    </GuideContext.Provider>
  )
}
