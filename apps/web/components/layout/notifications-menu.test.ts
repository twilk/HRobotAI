import { describe, expect, it } from 'vitest'
import { buildNotifs } from './notifications-menu'

// G2 — the bell must reflect REAL pending work (the old dot was always on). buildNotifs is the pure
// aggregation seam: only groups with count > 0 surface, so an empty result == no dot.

describe('buildNotifs', () => {
  it('surfaces only groups with a positive count', () => {
    const rows = buildNotifs({ pendingWnioski: 2, pendingSwaps: 0 })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ key: 'wnioski', count: 2, href: '/wnioski' })
  })

  it('returns an empty list when nothing is pending (bell stays quiet)', () => {
    expect(buildNotifs({ pendingWnioski: 0, pendingSwaps: 0 })).toEqual([])
  })

  it('surfaces both groups with correct deep-links', () => {
    const rows = buildNotifs({ pendingWnioski: 1, pendingSwaps: 3 })
    expect(rows.map((r) => r.key)).toEqual(['wnioski', 'zamiany'])
    expect(rows.find((r) => r.key === 'zamiany')).toMatchObject({ count: 3, href: '/zamiany' })
  })
})
