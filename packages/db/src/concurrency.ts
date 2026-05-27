export interface ItemFailure<T> {
  item: T
  error: Error
}

/**
 * Runs `worker` over `items` with at most `limit` in flight at once. Collects
 * (does not throw on) per-item failures so a single bad tenant does not abort
 * the whole fan-out. Returns the list of failures.
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<ItemFailure<T>[]> {
  const failures: ItemFailure<T>[] = []
  let cursor = 0

  async function runner(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++
      const item = items[index]!
      try {
        await worker(item)
      } catch (err) {
        failures.push({ item, error: err instanceof Error ? err : new Error(String(err)) })
      }
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, () => runner())
  await Promise.all(runners)
  return failures
}
