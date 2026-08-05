import { describe, it, expect } from 'vitest'
import { TOUR_STEPS } from './tour.data'

describe('tour data', () => {
  it('ma >=4 kroki, każdy z target + title + text', () => {
    expect(TOUR_STEPS.length).toBeGreaterThanOrEqual(4)
    for (const s of TOUR_STEPS) {
      expect(s.target).toBeTruthy()
      expect(s.title).toBeTruthy()
      expect(s.text).toBeTruthy()
    }
  })
  it('ma unikalne id', () => {
    const ids = TOUR_STEPS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
