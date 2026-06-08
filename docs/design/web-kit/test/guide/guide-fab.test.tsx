import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { GuideContext } from '@/components/guide/guide-provider'
import { GuideFab } from '@/components/guide/guide-fab'
import type { GuideContextValue } from '@/lib/guide/types'

function makeContext(overrides?: Partial<GuideContextValue>): GuideContextValue {
  return {
    startTour: vi.fn(),
    startJourney: vi.fn(),
    isDisabled: false,
    toggleDisabled: vi.fn(),
    activeSpaceId: 'dashboard',
    ...overrides,
  }
}

describe('GuideFab', () => {
  it('renders the ? button when activeSpaceId is set', () => {
    render(
      <GuideContext.Provider value={makeContext()}>
        <GuideFab />
      </GuideContext.Provider>,
    )
    expect(screen.getByRole('button', { name: /przewodnik/i })).toBeInTheDocument()
  })

  it('returns null when activeSpaceId is null', () => {
    render(
      <GuideContext.Provider value={makeContext({ activeSpaceId: null })}>
        <GuideFab />
      </GuideContext.Provider>,
    )
    expect(screen.queryByRole('button', { name: /przewodnik/i })).toBeNull()
  })

  it('calls startTour with activeSpaceId on click', async () => {
    const user = userEvent.setup()
    const startTour = vi.fn()
    render(
      <GuideContext.Provider value={makeContext({ startTour })}>
        <GuideFab />
      </GuideContext.Provider>,
    )
    await user.click(screen.getByRole('button', { name: /przewodnik/i }))
    expect(startTour).toHaveBeenCalledWith('dashboard')
  })

  it('has aria-label mentioning przewodnik', () => {
    render(
      <GuideContext.Provider value={makeContext()}>
        <GuideFab />
      </GuideContext.Provider>,
    )
    const btn = screen.getByRole('button', { name: /przewodnik/i })
    expect(btn).toHaveAttribute('aria-label')
  })
})
