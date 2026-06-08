import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { DostepyClientView } from '@/components/dostepy/dostepy-client-view'
import { getAllAccessSummaries } from '@/lib/dostepy'

const seedSummaries = getAllAccessSummaries()

describe('DostepyClientView', () => {
  it('renders the Dostępy heading', () => {
    render(<DostepyClientView initialData={seedSummaries} />)
    expect(screen.getByRole('heading', { name: /Dostępy/i })).toBeInTheDocument()
  })

  it('renders table with employee names', () => {
    render(<DostepyClientView initialData={seedSummaries} />)
    expect(screen.getByText('Anna Nowak')).toBeInTheDocument()
    expect(screen.getByText('Piotr Wiśniewski')).toBeInTheDocument()
    expect(screen.getByText('Katarzyna Wójcik')).toBeInTheDocument()
    expect(screen.getByText('Tomasz Kamiński')).toBeInTheDocument()
  })

  it('renders all 5 module column headers', () => {
    render(<DostepyClientView initialData={seedSummaries} />)
    expect(screen.getAllByText('Grafik').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Wnioski').length).toBeGreaterThanOrEqual(1)
    // 'Dostępy' appears in heading AND column header
    expect(screen.getAllByText('Dostępy').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Raporty').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Ustawienia').length).toBeGreaterThanOrEqual(1)
  })

  it('renders "Zarządzaj" buttons for each employee', () => {
    render(<DostepyClientView initialData={seedSummaries} />)
    const buttons = screen.getAllByRole('button', { name: /Zarządzaj/i })
    expect(buttons.length).toBe(seedSummaries.length)
  })

  it('shows access level badges (at minimum Brak and Edycja exist in seed data)', () => {
    render(<DostepyClientView initialData={seedSummaries} />)
    // Seed data has both 'brak' and 'edycja' entries
    expect(screen.getAllByText(/Brak/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/Edycja/i).length).toBeGreaterThanOrEqual(1)
  })

  it('search filters employees by name', async () => {
    const user = userEvent.setup()
    render(<DostepyClientView initialData={seedSummaries} />)
    const searchInput = screen.getByPlaceholderText(/Szukaj/i)
    await user.type(searchInput, 'Anna')
    expect(screen.getByText('Anna Nowak')).toBeInTheDocument()
    expect(screen.queryByText('Piotr Wiśniewski')).toBeNull()
    expect(screen.queryByText('Katarzyna Wójcik')).toBeNull()
  }, 15_000)

  it('shows empty state when search has no results', async () => {
    const user = userEvent.setup()
    render(<DostepyClientView initialData={seedSummaries} />)
    const searchInput = screen.getByPlaceholderText(/Szukaj/i)
    await user.type(searchInput, 'XYZ_NIEISTNIEJE')
    expect(screen.getAllByText(/Brak pracowników/i).length).toBeGreaterThanOrEqual(1)
  }, 15_000)

  it('opens management modal when "Zarządzaj" clicked', async () => {
    const user = userEvent.setup()
    render(<DostepyClientView initialData={seedSummaries} />)
    const buttons = screen.getAllByRole('button', { name: /Zarządzaj/i })
    await user.click(buttons[0])
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  }, 15_000)

  it('modal shows employee name and all 5 module radio groups', async () => {
    const user = userEvent.setup()
    render(<DostepyClientView initialData={seedSummaries} />)
    const buttons = screen.getAllByRole('button', { name: /Zarządzaj/i })
    await user.click(buttons[0])
    const dialog = screen.getByRole('dialog')
    // Should show employee name in heading / title area
    expect(dialog.textContent).toMatch(/Anna Nowak/)
    // Should show all 5 module labels
    expect(within(dialog).getByText('Grafik')).toBeInTheDocument()
    expect(within(dialog).getByText('Wnioski')).toBeInTheDocument()
    expect(within(dialog).getByText('Dostępy')).toBeInTheDocument()
    expect(within(dialog).getByText('Raporty')).toBeInTheDocument()
    expect(within(dialog).getByText('Ustawienia')).toBeInTheDocument()
  }, 15_000)

  it('saves access changes and closes modal', async () => {
    const user = userEvent.setup()
    render(<DostepyClientView initialData={seedSummaries} />)
    const buttons = screen.getAllByRole('button', { name: /Zarządzaj/i })
    await user.click(buttons[0])
    const dialog = screen.getByRole('dialog')
    // Click Save button
    const saveBtn = within(dialog).getByRole('button', { name: /Zapisz/i })
    await user.click(saveBtn)
    // Modal should close
    expect(screen.queryByRole('dialog')).toBeNull()
  }, 15_000)
})
