import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  isVisited,
  markVisited,
  isDisabled,
  setDisabled,
  getJourneyState,
  setJourneyState,
  clearJourneyState,
} from '@/lib/guide/store'
import type { GuideSpaceId, JourneyId } from '@/lib/guide/types'

const SPACE: GuideSpaceId = 'dashboard'
const JOURNEY: JourneyId = 'onboarding-pracownika'

beforeEach(() => {
  localStorage.clear()
})

describe('visited store', () => {
  it('returns false when space not visited', () => {
    expect(isVisited(SPACE)).toBe(false)
  })

  it('returns true after markVisited', () => {
    markVisited(SPACE)
    expect(isVisited(SPACE)).toBe(true)
  })

  it('does not affect other spaces', () => {
    markVisited(SPACE)
    expect(isVisited('pracownicy')).toBe(false)
  })
})

describe('disabled store', () => {
  it('returns false by default', () => {
    expect(isDisabled()).toBe(false)
  })

  it('returns true after setDisabled(true)', () => {
    setDisabled(true)
    expect(isDisabled()).toBe(true)
  })

  it('returns false after setDisabled(false)', () => {
    setDisabled(true)
    setDisabled(false)
    expect(isDisabled()).toBe(false)
  })
})

describe('journey state store', () => {
  it('returns null when no journey active', () => {
    expect(getJourneyState()).toBeNull()
  })

  it('returns stored journey state', () => {
    setJourneyState({ id: JOURNEY, step: 2, startedAt: '2026-06-07T12:00:00Z' })
    const state = getJourneyState()
    expect(state?.id).toBe(JOURNEY)
    expect(state?.step).toBe(2)
  })

  it('clears journey state', () => {
    setJourneyState({ id: JOURNEY, step: 0, startedAt: '2026-06-07T12:00:00Z' })
    clearJourneyState()
    expect(getJourneyState()).toBeNull()
  })
})

describe('SSR safety', () => {
  it('does not throw when localStorage is not available', () => {
    // Simulate SSR: getItem returns null, setItem is a no-op
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('localStorage not available')
    })
    expect(() => isVisited(SPACE)).not.toThrow()
    expect(isVisited(SPACE)).toBe(false)
  })
})
