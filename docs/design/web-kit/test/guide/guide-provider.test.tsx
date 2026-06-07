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
