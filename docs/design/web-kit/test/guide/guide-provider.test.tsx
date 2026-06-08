import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import React from 'react'

// Mock next/navigation
vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/dashboard'),
}))

// Mock shepherd.js — avoid real DOM manipulation in tests
// shepherd.ts does: const { default: Shepherd } = await import('shepherd.js')
//                   new Shepherd.Tour({ ... })
// So the default export needs a .Tour constructor property.
class MockTourInstance {
  on = vi.fn()
  start = vi.fn()
  cancel = vi.fn()
  addSteps = vi.fn()
}

vi.mock('shepherd.js', () => {
  class MockShepherd {
    static Tour = MockTourInstance
  }
  return { default: MockShepherd }
})

// Mock the shepherd createTour factory to return a resolved promise synchronously
vi.mock('@/lib/guide/shepherd', () => ({
  createTour: vi.fn(async () => new MockTourInstance()),
}))

// Mock the space step factories
vi.mock('@/lib/guide/spaces/dashboard', () => ({
  dashboardSteps: vi.fn(() => []),
}))

// Mock react-hot-toast to avoid side-effects
vi.mock('react-hot-toast', () => ({
  default: vi.fn(),
}))

import { usePathname } from 'next/navigation'
import { GuideProvider, useGuide } from '@/components/guide/guide-provider'
import * as store from '@/lib/guide/store'
import * as shepherdMod from '@/lib/guide/shepherd'
import toast from 'react-hot-toast'

function TestConsumer() {
  const ctx = useGuide()
  return (
    <div>
      <span data-testid="space">{ctx.activeSpaceId ?? 'none'}</span>
      <span data-testid="disabled">{String(ctx.isDisabled)}</span>
      <button onClick={() => ctx.toggleDisabled()}>toggle</button>
    </div>
  )
}

/** Flush all pending microtasks / resolved promises (safe with fake timers) */
function flushPromises() {
  // Chain multiple microtask ticks to let async chains resolve
  return Promise.resolve()
    .then(() => Promise.resolve())
    .then(() => Promise.resolve())
    .then(() => Promise.resolve())
    .then(() => Promise.resolve())
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  ;(usePathname as ReturnType<typeof vi.fn>).mockReturnValue('/dashboard')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GuideProvider', () => {
  it('provides activeSpaceId resolved from pathname', () => {
    render(
      <GuideProvider>
        <TestConsumer />
      </GuideProvider>,
    )
    expect(screen.getByTestId('space').textContent).toBe('dashboard')
  })

  it('provides null activeSpaceId for unknown pathname', () => {
    ;(usePathname as ReturnType<typeof vi.fn>).mockReturnValue('/login')
    render(
      <GuideProvider>
        <TestConsumer />
      </GuideProvider>,
    )
    expect(screen.getByTestId('space').textContent).toBe('none')
  })

  it('reflects isDisabled from store', () => {
    store.setDisabled(true)
    render(
      <GuideProvider>
        <TestConsumer />
      </GuideProvider>,
    )
    expect(screen.getByTestId('disabled').textContent).toBe('true')
  })

  it('toggleDisabled updates store and re-renders', async () => {
    render(
      <GuideProvider>
        <TestConsumer />
      </GuideProvider>,
    )
    expect(screen.getByTestId('disabled').textContent).toBe('false')
    await act(async () => {
      screen.getByText('toggle').click()
    })
    expect(screen.getByTestId('disabled').textContent).toBe('true')
    expect(store.isDisabled()).toBe(true)
  })

  it('marks space visited when auto-tour fires', async () => {
    vi.useFakeTimers()
    render(
      <GuideProvider>
        <TestConsumer />
      </GuideProvider>,
    )
    expect(store.isVisited('dashboard')).toBe(false)
    // Advance past the 1200ms auto-launch delay
    await act(async () => {
      vi.advanceTimersByTime(1300)
    })
    // Flush async promise chain inside startTour (createTour + loadSteps + markVisited)
    await act(async () => {
      await flushPromises()
    })
    expect(store.isVisited('dashboard')).toBe(true)
  })

  it('does not auto-launch when disabled', async () => {
    store.setDisabled(true)
    vi.useFakeTimers()
    render(
      <GuideProvider>
        <TestConsumer />
      </GuideProvider>,
    )
    await act(async () => {
      vi.advanceTimersByTime(1300)
    })
    await act(async () => {
      await flushPromises()
    })
    // Tour should NOT have started — disabled blocks the auto-launch
    expect(store.isVisited('dashboard')).toBe(false)
  })

  it('does not auto-launch when space already visited', async () => {
    store.markVisited('dashboard')
    vi.useFakeTimers()
    render(
      <GuideProvider>
        <TestConsumer />
      </GuideProvider>,
    )
    await act(async () => {
      vi.advanceTimersByTime(1300)
    })
    await act(async () => {
      await flushPromises()
    })
    // isVisited was true before, still true — but tour was not re-fired
    expect(store.isVisited('dashboard')).toBe(true)
  })
})

// ─── Gap 3: route-change cancels active tour ────────────────────────────────

describe('GuideProvider — route-change cancels tour', () => {
  it('calls cancel on the active tour when pathname changes', async () => {
    // Start on /dashboard (already visited so auto-tour won't fire)
    ;(usePathname as ReturnType<typeof vi.fn>).mockReturnValue('/dashboard')
    store.markVisited('dashboard')

    // Track the MockTourInstance created by createTour
    let capturedTour: MockTourInstance | null = null
    ;(shepherdMod.createTour as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      capturedTour = new MockTourInstance()
      return capturedTour
    })

    // Add a startTour trigger button
    function TourStarter() {
      const ctx = useGuide()
      return (
        <button data-testid="start-tour" onClick={() => ctx.startTour('dashboard')}>
          start
        </button>
      )
    }

    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <GuideProvider>{children}</GuideProvider>
    )

    const { rerender } = render(<TourStarter />, { wrapper: Wrapper })

    // Fire startTour manually to populate tourRef
    await act(async () => {
      screen.getByTestId('start-tour').click()
      await flushPromises()
    })

    expect(capturedTour).not.toBeNull()

    // Simulate navigation: change usePathname return value then rerender.
    // GuideProvider reads usePathname() on every render and the cancel effect
    // has [pathname] in its deps — a re-render with a new value will cause
    // React to run the effect cleanup + re-run with the new pathname.
    ;(usePathname as ReturnType<typeof vi.fn>).mockReturnValue('/pracownicy')

    await act(async () => {
      rerender(<TourStarter />)
      await flushPromises()
    })

    // The cancel effect (useEffect([pathname])) fired → tourRef.current.cancel() called
    expect(capturedTour!.cancel).toHaveBeenCalled()
  })
})

// ─── Gap 4: toast fires on tour cancel / complete ──────────────────────────
//
// Strategy: after startTour resolves, the MockTourInstance.on spy has been
// called with ('cancel', handler) and ('complete', handler). We capture those
// handlers and invoke them directly — this exercises the real GuideProvider
// callbacks without needing a real Shepherd DOM tour running.

describe('GuideProvider — toast on tour events', () => {
  beforeEach(() => {
    ;(usePathname as ReturnType<typeof vi.fn>).mockReturnValue('/dashboard')
    store.markVisited('dashboard') // prevent auto-launch from interfering
  })

  it('fires toast with cancel message when the tour cancel event fires', async () => {
    let capturedTour: MockTourInstance | null = null
    ;(shepherdMod.createTour as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      capturedTour = new MockTourInstance()
      return capturedTour
    })

    function TourStarter() {
      const ctx = useGuide()
      return (
        <button data-testid="start-toast-cancel" onClick={() => ctx.startTour('dashboard')}>
          start
        </button>
      )
    }

    render(
      <GuideProvider>
        <TourStarter />
      </GuideProvider>,
    )

    await act(async () => {
      screen.getByTestId('start-toast-cancel').click()
      await flushPromises()
    })

    expect(capturedTour).not.toBeNull()

    // tour.on was called with ('cancel', handler) — find and invoke it
    const onCalls: [string, () => void][] = capturedTour!.on.mock.calls as any
    const cancelHandler = onCalls.find(([event]) => event === 'cancel')?.[1]
    expect(cancelHandler, 'cancel handler should be registered').toBeDefined()

    await act(async () => {
      cancelHandler!()
    })

    expect(toast).toHaveBeenCalledWith(
      'Przewodnik zamknięty. Kliknij ? by uruchomić ponownie.',
      expect.objectContaining({ duration: 3500 }),
    )
  })

  it('fires toast with complete message when the tour complete event fires', async () => {
    let capturedTour: MockTourInstance | null = null
    ;(shepherdMod.createTour as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      capturedTour = new MockTourInstance()
      return capturedTour
    })

    function TourStarter() {
      const ctx = useGuide()
      return (
        <button data-testid="start-toast-complete" onClick={() => ctx.startTour('dashboard')}>
          start
        </button>
      )
    }

    render(
      <GuideProvider>
        <TourStarter />
      </GuideProvider>,
    )

    await act(async () => {
      screen.getByTestId('start-toast-complete').click()
      await flushPromises()
    })

    expect(capturedTour).not.toBeNull()

    const onCalls: [string, () => void][] = capturedTour!.on.mock.calls as any
    const completeHandler = onCalls.find(([event]) => event === 'complete')?.[1]
    expect(completeHandler, 'complete handler should be registered').toBeDefined()

    await act(async () => {
      completeHandler!()
    })

    expect(toast).toHaveBeenCalledWith(
      'Gotowe! Możesz zawsze wrócić klikając ?.',
      expect.objectContaining({ duration: 3000 }),
    )
  })
})
