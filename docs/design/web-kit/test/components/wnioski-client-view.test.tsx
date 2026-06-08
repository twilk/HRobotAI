import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

// Reset the wnioski store before each test by re-importing a fresh module
// (Vitest shares module instances across tests in the same file, so we need
// to be careful about state leakage from addLeaveRequest calls.)
// Strategy: use actual seed data + test against visible text.

import { WnioskiClientView } from '@/components/wnioski/wnioski-client-view'
import { getLeaveRequests } from '@/lib/wnioski'

const seedRequests = getLeaveRequests()

describe('WnioskiClientView', () => {
  it('renders list of leave requests', () => {
    render(<WnioskiClientView initialRequests={seedRequests} />)
    // From seed data: Anna Nowak has 2 requests, Piotr Wiśniewski has 1
    expect(screen.getAllByText('Anna Nowak').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Piotr Wiśniewski').length).toBeGreaterThanOrEqual(1)
  })

  it('shows leave type labels', () => {
    render(<WnioskiClientView initialRequests={seedRequests} />)
    // Seed has approved urlop-wypoczynkowy for Anna Nowak
    expect(screen.getAllByText('Urlop wypoczynkowy').length).toBeGreaterThanOrEqual(1)
  })

  it('shows status badges', () => {
    render(<WnioskiClientView initialRequests={seedRequests} />)
    expect(screen.getAllByText('Zatwierdzony').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Oczekujący').length).toBeGreaterThanOrEqual(1)
  })

  it('renders filter tabs: Wszystkie, Oczekujące, Zatwierdzone, Odrzucone', () => {
    render(<WnioskiClientView initialRequests={seedRequests} />)
    expect(screen.getByRole('tab', { name: 'Wszystkie' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Oczekujące' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Zatwierdzone' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Odrzucone' })).toBeInTheDocument()
  })

  it('filters by "Oczekujące" tab — shows only pending requests', async () => {
    const user = userEvent.setup()
    render(<WnioskiClientView initialRequests={seedRequests} />)
    await user.click(screen.getByRole('tab', { name: 'Oczekujące' }))
    // Should not show approved
    expect(screen.queryByText('Zatwierdzony')).toBeNull()
    // Should still show oczekujące
    expect(screen.getAllByText('Oczekujący').length).toBeGreaterThanOrEqual(1)
  })

  it('filters by "Zatwierdzone" tab — shows only approved requests', async () => {
    const user = userEvent.setup()
    render(<WnioskiClientView initialRequests={seedRequests} />)
    await user.click(screen.getByRole('tab', { name: 'Zatwierdzone' }))
    expect(screen.queryByText('Oczekujący')).toBeNull()
    expect(screen.getAllByText('Zatwierdzony').length).toBeGreaterThanOrEqual(1)
  })

  it('filters by "Odrzucone" tab — shows only rejected requests', async () => {
    const user = userEvent.setup()
    render(<WnioskiClientView initialRequests={seedRequests} />)
    await user.click(screen.getByRole('tab', { name: 'Odrzucone' }))
    expect(screen.queryByText('Oczekujący')).toBeNull()
    expect(screen.getAllByText('Odrzucony').length).toBeGreaterThanOrEqual(1)
  })

  it('shows empty state when filter has no matching requests', async () => {
    const user = userEvent.setup()
    // Use only approved requests — then switch to Odrzucone which has none
    const onlyApproved = seedRequests.filter((r) => r.status === 'approved')
    render(<WnioskiClientView initialRequests={onlyApproved} />)
    await user.click(screen.getByRole('tab', { name: 'Odrzucone' }))
    // EmptyState renders both a heading and body text; use getAllByText
    expect(screen.getAllByText(/Brak wniosków/i).length).toBeGreaterThanOrEqual(1)
  })

  it('opens "Złóż wniosek" modal when button clicked', async () => {
    const user = userEvent.setup()
    render(<WnioskiClientView initialRequests={seedRequests} />)
    await user.click(screen.getByRole('button', { name: /Złóż wniosek/ }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('dialog').querySelector('h2')?.textContent).toMatch(/Złóż wniosek/i)
  })

  it('submits new request and adds to list', async () => {
    const user = userEvent.setup()
    render(<WnioskiClientView initialRequests={seedRequests} />)
    await user.click(screen.getByRole('button', { name: /Złóż wniosek/ }))

    const dialog = screen.getByRole('dialog')

    // Select employee
    const employeeSelect = within(dialog).getByLabelText('Pracownik')
    await user.selectOptions(employeeSelect, '1')

    // Select leave type
    const typeSelect = within(dialog).getByLabelText('Typ urlopu')
    await user.selectOptions(typeSelect, 'inne')

    // Fill dates
    const dateFrom = within(dialog).getByLabelText('Data od')
    await user.clear(dateFrom)
    await user.type(dateFrom, '2026-12-01')

    const dateTo = within(dialog).getByLabelText('Data do')
    await user.clear(dateTo)
    await user.type(dateTo, '2026-12-03')

    // Fill days
    const daysInput = within(dialog).getByLabelText('Liczba dni')
    await user.clear(daysInput)
    await user.type(daysInput, '3')

    await user.click(within(dialog).getByRole('button', { name: /Złóż/i }))

    // Modal should close
    expect(screen.queryByRole('dialog')).toBeNull()
    // New item should appear (Katarzyna Wójcik for employeeId '3' isn't selected here; employee '1' = Anna Nowak)
    // The list should now have one more item with 'Oczekujący' badge
    expect(screen.getAllByText('Oczekujący').length).toBeGreaterThanOrEqual(2)
  }, 20_000)

  it('approve button on pending request updates status to Zatwierdzony', async () => {
    const user = userEvent.setup()
    // Use only pending requests so we know we see approve buttons
    const pendingRequests = seedRequests.filter((r) => r.status === 'pending')
    render(<WnioskiClientView initialRequests={pendingRequests} />)

    // Click the first Zatwierdź button
    const approveButtons = screen.getAllByRole('button', { name: /Zatwierdź/ })
    await user.click(approveButtons[0])

    // The item should now show Zatwierdzony instead of Oczekujący
    expect(screen.getAllByText('Zatwierdzony').length).toBeGreaterThanOrEqual(1)
  }, 15_000)
})
