import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ScheduleGrid } from '@/components/grafik/schedule-grid'
import { getFacilities } from '@/lib/facilities'
import { SEED_SHIFTS } from '@/lib/schedule'

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
})
