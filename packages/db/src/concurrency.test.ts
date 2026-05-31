import { runWithConcurrency } from './concurrency.js'

describe('runWithConcurrency', () => {
  it('runs every item and returns no failures on success', async () => {
    const seen: number[] = []
    const failures = await runWithConcurrency([1, 2, 3, 4], 2, async (n) => {
      seen.push(n)
    })
    expect(seen.sort()).toEqual([1, 2, 3, 4])
    expect(failures).toEqual([])
  })

  it('never exceeds the concurrency limit', async () => {
    let active = 0
    let maxActive = 0
    await runWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
    })
    expect(maxActive).toBeLessThanOrEqual(2)
  })

  it('collects failures without aborting the rest', async () => {
    const failures = await runWithConcurrency([1, 2, 3], 3, async (n) => {
      if (n === 2) throw new Error('boom on 2')
    })
    expect(failures).toHaveLength(1)
    expect(failures[0]!.item).toBe(2)
    expect(failures[0]!.error.message).toBe('boom on 2')
  })

  it('throws on a non-positive or non-integer limit (would silently run nothing)', async () => {
    const seen: number[] = []
    await expect(runWithConcurrency([1, 2], 0, async (n) => void seen.push(n))).rejects.toThrow(
      /positive integer/,
    )
    await expect(runWithConcurrency([1, 2], -1, async (n) => void seen.push(n))).rejects.toThrow(
      /positive integer/,
    )
    await expect(runWithConcurrency([1, 2], 1.5, async (n) => void seen.push(n))).rejects.toThrow(
      /positive integer/,
    )
    expect(seen).toEqual([]) // nothing ran
  })
})
