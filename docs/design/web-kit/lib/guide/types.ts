import type { StepOptions as ShepherdStepOptions, Tour as ShepherdTour } from 'shepherd.js'

// ─── Space IDs ────────────────────────────────────────────────────────────────

export type GuideSpaceId =
  | 'dashboard'
  | 'pracownicy'
  | 'pracownicy-id'
  | 'grafik'
  | 'wnioski'
  | 'dostepy'
  | 'ustawienia'
  | 'ustawienia-placowki'
  | 'ustawienia-uzytkownicy'

// ─── Journey IDs ──────────────────────────────────────────────────────────────

export type JourneyId =
  | 'onboarding-pracownika'
  | 'zarzadzanie-wnioskiem'
  | 'konfiguracja-placowki'
  | 'zaproszenie-managera'

// ─── Space metadata ───────────────────────────────────────────────────────────

export interface GuideSpace {
  id: GuideSpaceId
  label: string
  pathname: string
  pathnameMatch: 'exact' | 'prefix'
}

// ─── Re-export Shepherd types for convenience ─────────────────────────────────

export type { ShepherdStepOptions, ShepherdTour }

// ─── Journey step (cross-space) ───────────────────────────────────────────────

export interface JourneyStep {
  spaceId: GuideSpaceId
  /** Shepherd Step options for this step in the journey */
  step: ShepherdStepOptions
}

export interface Journey {
  id: JourneyId
  label: string
  description: string
  steps: JourneyStep[]
}

// ─── localStorage state ───────────────────────────────────────────────────────

/** Which spaces the current user has already seen their auto-tour for */
export type VisitedStore = Partial<Record<GuideSpaceId, true>>

/** If true, never auto-launch tours on first visit */
export type DisabledStore = boolean

/** Active cross-space journey progress */
export interface JourneyState {
  id: JourneyId
  /** Global step index across all journey spaces combined */
  step: number
  startedAt: string
}

// ─── React Context ────────────────────────────────────────────────────────────

export interface GuideContextValue {
  startTour: (spaceId?: GuideSpaceId) => void
  startJourney: (journeyId: JourneyId) => void
  isDisabled: boolean
  toggleDisabled: () => void
  activeSpaceId: GuideSpaceId | null
}
