import { describe, it, expect } from 'vitest'
import { nextIndex, isLast, clampIndex } from './tour.logic'

describe('tour logic — nextIndex', () => {
  it('idzie dalej i wstecz w granicach', () => {
    expect(nextIndex(0, 4, 1)).toBe(1)
    expect(nextIndex(2, 4, -1)).toBe(1)
  })
  it('nie zawija się na krańcach (zatrzymuje się)', () => {
    expect(nextIndex(3, 4, 1)).toBe(3)
    expect(nextIndex(0, 4, -1)).toBe(0)
  })
  it('jest bezpieczny dla pustej listy', () => {
    expect(nextIndex(0, 0, 1)).toBe(0)
  })
})

describe('tour logic — isLast', () => {
  it('wykrywa ostatni krok', () => {
    expect(isLast(3, 4)).toBe(true)
    expect(isLast(2, 4)).toBe(false)
  })
})

describe('tour logic — clampIndex', () => {
  it('zaciska poza-zakresowe wartości', () => {
    expect(clampIndex(-5, 4)).toBe(0)
    expect(clampIndex(99, 4)).toBe(3)
    expect(clampIndex(1, 4)).toBe(1)
  })
})
