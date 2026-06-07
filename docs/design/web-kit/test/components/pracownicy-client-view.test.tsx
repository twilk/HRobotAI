import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { PracownicyClientView } from '@/components/employees/pracownicy-client-view'
import { getEmployees } from '@/lib/employees'

const employees = getEmployees()

describe('PracownicyClientView', () => {
  it('renders all employees initially', () => {
    render(<PracownicyClientView initialEmployees={employees} />)
    expect(screen.getByText('Anna Nowak')).toBeInTheDocument()
    expect(screen.getByText('Piotr Wiśniewski')).toBeInTheDocument()
  })

  it('filters employees by name on search', async () => {
    const user = userEvent.setup()
    render(<PracownicyClientView initialEmployees={employees} />)
    await user.type(screen.getByRole('searchbox'), 'Anna')
    expect(screen.getByText('Anna Nowak')).toBeInTheDocument()
    expect(screen.queryByText('Piotr Wiśniewski')).toBeNull()
  })

  it('shows no-results message when search has no matches', async () => {
    const user = userEvent.setup()
    render(<PracownicyClientView initialEmployees={employees} />)
    await user.type(screen.getByRole('searchbox'), 'zzznonexistent')
    expect(screen.getByText(/Brak wyników/)).toBeInTheDocument()
  })

  it('opens add employee modal when Dodaj button clicked', async () => {
    const user = userEvent.setup()
    render(<PracownicyClientView initialEmployees={employees} />)
    await user.click(screen.getByRole('button', { name: /Dodaj pracownika/ }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    // Modal h2 title should be visible inside the dialog
    expect(dialog.querySelector('h2')?.textContent).toMatch(/Dodaj pracownika/i)
  })

  it('adds employee to list when form submitted', async () => {
    const user = userEvent.setup()
    render(<PracownicyClientView initialEmployees={employees} />)
    await user.click(screen.getByRole('button', { name: /Dodaj pracownika/ }))
    await user.type(screen.getByLabelText('Imię'), 'Zofia')
    await user.type(screen.getByLabelText('Nazwisko'), 'Testowa')
    await user.type(screen.getByLabelText('Email'), 'z.testowa@acme.pl')
    await user.type(screen.getByLabelText('Stanowisko'), 'Tester')
    await user.type(screen.getByLabelText('Jednostka'), 'QA')
    await user.click(screen.getByRole('button', { name: /Zapisz/ }))
    expect(screen.getByText('Zofia Testowa')).toBeInTheDocument()
  }, 15_000)
})
