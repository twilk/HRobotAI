import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchBar } from '@/components/search/search-bar'
import { resetEmployees } from '@/lib/employees'
import { resetNotifications } from '@/lib/notifications'

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

beforeEach(() => {
  resetEmployees()
  resetNotifications()
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.runAllTimers()
  vi.useRealTimers()
})

describe('SearchBar', () => {
  it('renders search input', () => {
    render(<SearchBar />)
    expect(screen.getByRole('searchbox')).toBeInTheDocument()
  })

  it('has a placeholder attribute on the input', () => {
    render(<SearchBar />)
    const input = screen.getByRole('searchbox')
    expect(input).toHaveAttribute('placeholder')
  })

  it('shows results dropdown when typing a matching query', async () => {
    render(<SearchBar />)
    const input = screen.getByRole('searchbox')
    await userEvent.type(input, 'Anna', { delay: null })
    act(() => vi.advanceTimersByTime(400))
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('shows Brak wyników when no results found for valid query', async () => {
    render(<SearchBar />)
    const input = screen.getByRole('searchbox')
    await userEvent.type(input, 'xxxxxxxxnotfound', { delay: null })
    act(() => vi.advanceTimersByTime(400))
    await waitFor(() => {
      expect(screen.getByText(/brak wyników/i)).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('closes dropdown on Escape key', async () => {
    render(<SearchBar />)
    const input = screen.getByRole('searchbox')
    await userEvent.type(input, 'Anna', { delay: null })
    act(() => vi.advanceTimersByTime(400))
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument()
    }, { timeout: 3000 })
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('shows up to 5 results in dropdown', async () => {
    render(<SearchBar />)
    const input = screen.getByRole('searchbox')
    await userEvent.type(input, 'Anna', { delay: null })
    act(() => vi.advanceTimersByTime(400))
    await waitFor(() => {
      const listbox = screen.queryByRole('listbox')
      expect(listbox).not.toBeNull()
    }, { timeout: 3000 })
    const options = screen.queryAllByRole('option')
    expect(options.length).toBeLessThanOrEqual(5)
    expect(options.length).toBeGreaterThan(0)
  })

  it('does not show dropdown when query is below 2 chars', async () => {
    render(<SearchBar />)
    const input = screen.getByRole('searchbox')
    await userEvent.type(input, 'A', { delay: null })
    act(() => vi.advanceTimersByTime(400))
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
