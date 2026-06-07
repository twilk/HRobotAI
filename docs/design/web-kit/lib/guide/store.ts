import type { GuideSpaceId, JourneyState, VisitedStore } from './types'

const KEYS = {
  visited:  'hrobot_guide_v1_visited',
  disabled: 'hrobot_guide_v1_disabled',
  journey:  'hrobot_guide_v1_journey',
} as const

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // SSR or storage quota — silently ignore
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // SSR — silently ignore
  }
}

// ─── Visited ──────────────────────────────────────────────────────────────────

export function isVisited(spaceId: GuideSpaceId): boolean {
  const raw = safeGet(KEYS.visited)
  if (!raw) return false
  try {
    const store: VisitedStore = JSON.parse(raw)
    return store[spaceId] === true
  } catch {
    return false
  }
}

export function markVisited(spaceId: GuideSpaceId): void {
  const raw = safeGet(KEYS.visited)
  let store: VisitedStore = {}
  if (raw) {
    try { store = JSON.parse(raw) } catch { /* ignore */ }
  }
  store[spaceId] = true
  safeSet(KEYS.visited, JSON.stringify(store))
}

// ─── Disabled ─────────────────────────────────────────────────────────────────

export function isDisabled(): boolean {
  return safeGet(KEYS.disabled) === 'true'
}

export function setDisabled(value: boolean): void {
  if (value) {
    safeSet(KEYS.disabled, 'true')
  } else {
    safeRemove(KEYS.disabled)
  }
}

// ─── Journey State ────────────────────────────────────────────────────────────

export function getJourneyState(): JourneyState | null {
  const raw = safeGet(KEYS.journey)
  if (!raw) return null
  try {
    return JSON.parse(raw) as JourneyState
  } catch {
    return null
  }
}

export function setJourneyState(state: JourneyState): void {
  safeSet(KEYS.journey, JSON.stringify(state))
}

export function clearJourneyState(): void {
  safeRemove(KEYS.journey)
}
