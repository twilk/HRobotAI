import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeButtons } from '@/lib/guide/shepherd'

// makeButtons() accepts a plain object that matches the tour interface —
// no real Shepherd import is needed here.

function makeTourMock() {
  return {
    back: vi.fn(),
    next: vi.fn(),
    cancel: vi.fn(),
    complete: vi.fn(),
  }
}

describe('makeButtons', () => {
  let tour: ReturnType<typeof makeTourMock>

  beforeEach(() => {
    tour = makeTourMock()
  })

  // ── disable button ───────────────────────────────────────────────────────────

  it('includes a disable button when isFirst and onDisable is provided', () => {
    const onDisable = vi.fn()
    const buttons = makeButtons(tour, { isFirst: true, isLast: false, onDisable }) as any[]

    const disableBtn = buttons.find((b) => b.attrs?.['data-testid'] === 'guide-btn-disable')
    expect(disableBtn).toBeDefined()
    expect(disableBtn.text).toBe('Wyłącz auto-start')

    // Invoking its action should call onDisable and tour.cancel
    disableBtn.action()
    expect(onDisable).toHaveBeenCalledOnce()
    expect(tour.cancel).toHaveBeenCalledOnce()
  })

  it('does not include a disable button when isFirst but no onDisable', () => {
    const buttons = makeButtons(tour, { isFirst: true, isLast: false }) as any[]

    const disableBtn = buttons.find((b) => b.attrs?.['data-testid'] === 'guide-btn-disable')
    expect(disableBtn).toBeUndefined()
  })

  // ── back button ──────────────────────────────────────────────────────────────

  it('includes a back button when not isFirst', () => {
    const buttons = makeButtons(tour, { isFirst: false, isLast: false }) as any[]

    const backBtn = buttons.find((b) => b.attrs?.['data-testid'] === 'guide-btn-back')
    expect(backBtn).toBeDefined()
    expect(backBtn.text).toBe('Wstecz')

    backBtn.action()
    expect(tour.back).toHaveBeenCalledOnce()
  })

  it('does not include a back button when isFirst', () => {
    const buttons = makeButtons(tour, { isFirst: true, isLast: false }) as any[]

    const backBtn = buttons.find((b) => b.attrs?.['data-testid'] === 'guide-btn-back')
    expect(backBtn).toBeUndefined()
  })

  // ── last / next button ───────────────────────────────────────────────────────

  it('uses "Gotowe" text and calls tour.complete when isLast', () => {
    const buttons = makeButtons(tour, { isFirst: false, isLast: true }) as any[]

    const doneBtn = buttons.find((b) => b.attrs?.['data-testid'] === 'guide-btn-done')
    expect(doneBtn).toBeDefined()
    expect(doneBtn.text).toBe('Gotowe')

    doneBtn.action()
    expect(tour.complete).toHaveBeenCalledOnce()
    expect(tour.next).not.toHaveBeenCalled()
  })

  it('uses "Dalej →" text and calls tour.next when not isLast', () => {
    const buttons = makeButtons(tour, { isFirst: false, isLast: false }) as any[]

    const nextBtn = buttons.find((b) => b.attrs?.['data-testid'] === 'guide-btn-next')
    expect(nextBtn).toBeDefined()
    expect(nextBtn.text).toBe('Dalej →')

    nextBtn.action()
    expect(tour.next).toHaveBeenCalledOnce()
    expect(tour.complete).not.toHaveBeenCalled()
  })

  // ── skip button always present ───────────────────────────────────────────────

  it('always includes a skip button that calls tour.cancel', () => {
    const buttons = makeButtons(tour, { isFirst: true, isLast: false }) as any[]

    const skipBtn = buttons.find((b) => b.attrs?.['data-testid'] === 'guide-btn-skip')
    expect(skipBtn).toBeDefined()
    expect(skipBtn.text).toBe('Pomiń')

    skipBtn.action()
    expect(tour.cancel).toHaveBeenCalledOnce()
  })
})
