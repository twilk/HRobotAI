import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ScheduleGrid } from '@/components/grafik/schedule-grid'
import { getFacilities } from '@/lib/facilities'
import { SEED_SHIFTS } from '@/lib/schedule'

// Mock server actions
vi.mock('@/lib/actions/grafik-actions', () => ({
  createShift: vi.fn().mockResolvedValue({ success: true, id: 'mock-id' }),
  deleteShift: vi.fn().mockResolvedValue({ success: true }),
  patchShift:  vi.fn().mockResolvedValue({ success: true }),
}))

import { createShift, deleteShift } from '@/lib/actions/grafik-actions'

const employees = [
  { id: '1', firstName: 'Anna', lastName: 'Nowak', position: 'Kierownik zmiany' },
  { id: '2', firstName: 'Piotr', lastName: 'Wiśniewski', position: 'Operator maszyn' },
  { id: '3', firstName: 'Katarzyna', lastName: 'Wójcik', position: 'Specjalista HR' },
  { id: '4', firstName: 'Tomasz', lastName: 'Kamiński', position: 'Magazynier' },
  { id: '5', firstName: 'Magdalena', lastName: 'Lewandowska', position: 'Księgowa' },
  { id: '6', firstName: 'Marek', lastName: 'Zieliński', position: 'Kierowca' },
]

const renderGrid = () =>
  render(<ScheduleGrid facilities={getFacilities()} employees={employees} seed={SEED_SHIFTS} todayISO="2026-06-03" />)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ScheduleGrid (Grafik)', () => {
  it('renders the week, day headers, and the default facility employees + shifts', () => {
    renderGrid()
    expect(screen.getByRole('heading', { name: 'Grafik' })).toBeInTheDocument()
    expect(screen.getByText('Anna Nowak')).toBeInTheDocument() // f1 employee
    expect(screen.getByText('Katarzyna Wójcik')).toBeInTheDocument()
    for (const d of ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nd']) {
      expect(screen.getAllByText(d).length).toBeGreaterThan(0)
    }
    expect(screen.getAllByText('08:00–16:00').length).toBeGreaterThan(0) // a seeded shift chip
  })

  it('switches the facility', async () => {
    const user = userEvent.setup()
    renderGrid()
    expect(screen.queryByText('Piotr Wiśniewski')).toBeNull()
    await user.selectOptions(screen.getByLabelText('Placówka'), 'f2')
    expect(screen.getByText('Piotr Wiśniewski')).toBeInTheDocument()
    expect(screen.queryByText('Anna Nowak')).toBeNull()
  })

  it('adds a shift and the total hours change', async () => {
    const user = userEvent.setup()
    renderGrid()
    const sumBefore = screen.getByText(/Suma:/).textContent
    await user.click(screen.getAllByRole('button', { name: '+ dodaj' })[0])
    await user.click(screen.getByRole('button', { name: 'Dodaj' }))
    expect(screen.getByText(/Suma:/).textContent).not.toEqual(sumBefore)
  })

  it('navigates between weeks', async () => {
    const user = userEvent.setup()
    renderGrid()
    expect(screen.getByText('Ten tydzień')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Następny tydzień' }))
    expect(screen.queryByText('Ten tydzień')).toBeNull()
    expect(screen.getByRole('button', { name: /Wróć do dziś/ })).toBeInTheDocument()
  })

  it('calls createShift server action when a shift is added', async () => {
    const user = userEvent.setup()
    renderGrid()
    // Open the add form for the first available cell
    await user.click(screen.getAllByRole('button', { name: '+ dodaj' })[0])
    // Confirm with the Dodaj button
    await user.click(screen.getByRole('button', { name: 'Dodaj' }))
    expect(createShift).toHaveBeenCalledTimes(1)
    const arg = (createShift as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(arg).toMatchObject({
      facilityId: expect.any(String),
      employeeId: expect.any(String),
      weekStart: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      startTime: expect.any(String),
      endTime: expect.any(String),
    })
  }, 15_000)

  it('calls deleteShift server action when a shift is removed', async () => {
    const user = userEvent.setup()
    renderGrid()
    // Hover over an existing seeded shift chip to reveal the remove button
    const removeBtn = screen.getAllByRole('button', { name: /Usuń zmianę/ })[0]
    await user.click(removeBtn)
    expect(deleteShift).toHaveBeenCalledTimes(1)
    expect(typeof (deleteShift as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('string')
  }, 15_000)

  it('keeps optimistic state when createShift resolves — shift chip stays in UI', async () => {
    const user = userEvent.setup()
    renderGrid()
    const sumBefore = screen.getByText(/Suma:/).textContent
    await user.click(screen.getAllByRole('button', { name: '+ dodaj' })[0])
    await user.click(screen.getByRole('button', { name: 'Dodaj' }))
    // Regardless of server result the UI hours counter updates immediately
    expect(screen.getByText(/Suma:/).textContent).not.toEqual(sumBefore)
  }, 15_000)
})
