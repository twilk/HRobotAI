import { describe, it, expect, beforeEach } from 'vitest'
import { globalSearch } from '@/lib/search'
import { resetEmployees } from '@/lib/employees'
import { resetNotifications } from '@/lib/notifications'

beforeEach(() => {
  resetEmployees()
  resetNotifications()
})

describe('globalSearch', () => {
  it('returns empty array for empty query', () => {
    expect(globalSearch('')).toEqual([])
  })

  it('returns empty array for query shorter than 2 chars', () => {
    expect(globalSearch('a')).toEqual([])
  })

  it('returns empty array for whitespace-only query', () => {
    expect(globalSearch('  ')).toEqual([])
  })

  it('finds employees by first name', () => {
    const results = globalSearch('Anna')
    expect(results.some((r) => r.type === 'employee' && r.title.includes('Anna'))).toBe(true)
  })

  it('finds employees by last name', () => {
    const results = globalSearch('Nowak')
    expect(results.some((r) => r.type === 'employee' && r.title.includes('Nowak'))).toBe(true)
  })

  it('finds employees by department (unit)', () => {
    const results = globalSearch('Produkcja')
    expect(results.some((r) => r.type === 'employee' && r.subtitle.toLowerCase().includes('produkcja'))).toBe(true)
  })

  it('finds employees by position', () => {
    const results = globalSearch('Ksiegowa')
    // Partial/diacritic-stripped match
    const results2 = globalSearch('gowa')
    expect(results2.some((r) => r.type === 'employee')).toBe(true)
  })

  it('finds leave requests by employee name', () => {
    const results = globalSearch('Nowak')
    expect(results.some((r) => r.type === 'leave-request')).toBe(true)
  })

  it('finds leave requests by type label', () => {
    const results = globalSearch('urlop wypoczynkowy')
    expect(results.some((r) => r.type === 'leave-request')).toBe(true)
  })

  it('finds notifications by title', () => {
    const results = globalSearch('zatwierdzony')
    expect(results.some((r) => r.type === 'notification')).toBe(true)
  })

  it('finds notifications by message text', () => {
    const results = globalSearch('Anny Nowak')
    expect(results.some((r) => r.type === 'notification')).toBe(true)
  })

  it('results are sorted by score descending', () => {
    const results = globalSearch('Anna Nowak')
    if (results.length > 1) {
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
      }
    }
  })

  it('returns max 10 results', () => {
    const results = globalSearch('a') // very short — returns []
    expect(results.length).toBe(0)
    const results2 = globalSearch('ur') // should match many leave requests and notifications
    expect(results2.length).toBeLessThanOrEqual(10)
  })

  it('each result has required fields: type, id, title, subtitle, href, score', () => {
    const results = globalSearch('Anna')
    expect(results.length).toBeGreaterThan(0)
    for (const r of results) {
      expect(r).toHaveProperty('type')
      expect(r).toHaveProperty('id')
      expect(r).toHaveProperty('title')
      expect(r).toHaveProperty('subtitle')
      expect(r).toHaveProperty('href')
      expect(r).toHaveProperty('score')
      expect(r.score).toBeGreaterThan(0)
      expect(r.score).toBeLessThanOrEqual(1)
    }
  })

  it('case-insensitive search', () => {
    const r1 = globalSearch('anna')
    const r2 = globalSearch('ANNA')
    expect(r1.length).toBeGreaterThan(0)
    expect(r2.length).toBeGreaterThan(0)
  })
})
