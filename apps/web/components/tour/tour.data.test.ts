import { describe, it, expect } from 'vitest'
import { TOUR_STEPS } from './tour.data'
import { NAV } from '@/lib/nav'

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

  // Regresja 2026-08-10: przewodnik kotwiczy się selektorami CSS do linków nawigacji, ale NIC nie
  // wymuszało, żeby te selektory wskazywały na istniejący link. Dwa kroki przez to nie znajdowały
  // celu: `[data-tour="dashboard"]` (atrybut nieobecny w całym apps/web) i `[href="/analiza"]`
  // (moduł mieszka pod `/analityk`). Stary test tego nie łapał — sprawdzał wyłącznie, czy `target`
  // jest niepustym stringiem. Te dwa testy trzymają przewodnik zsynchronizowany z `lib/nav.ts`.
  const NAV_HREFS = new Set(NAV.flatMap((group) => group.items.map((item) => item.href)))

  it('każdy target w formie [href="..."] wskazuje na trasę obecną w nawigacji', () => {
    for (const step of TOUR_STEPS) {
      const match = /^\[href="([^"]+)"\]$/.exec(step.target)
      expect(match, `krok "${step.id}": target "${step.target}" nie jest selektorem [href="..."]`).not.toBeNull()
      expect(NAV_HREFS, `krok "${step.id}" celuje w "${match![1]}", którego nie ma w NAV`).toContain(match![1])
    }
  })

  it('screen kroku zgadza się z trasą, w którą celuje jego selektor', () => {
    for (const step of TOUR_STEPS) {
      const href = /^\[href="([^"]+)"\]$/.exec(step.target)![1]
      expect(step.screen, `krok "${step.id}": screen "${step.screen}" != target "${href}"`).toBe(href)
    }
  })
})
