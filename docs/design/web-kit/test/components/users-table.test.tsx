import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UsersTable } from '@/components/users/users-table'
import { getUsers } from '@/lib/users'

describe('UsersTable', () => {
  it('renders user names and mono emails', () => {
    render(<UsersTable users={getUsers()} />)
    expect(screen.getByText('Jan Kowalski')).toBeInTheDocument()
    expect(screen.getByText('jan.kowalski@acme.pl')).toBeInTheDocument()
  })

  it('renders role badges', () => {
    render(<UsersTable users={getUsers()} />)
    expect(screen.getByText('Admin klienta')).toBeInTheDocument()
    expect(screen.getByText('HR')).toBeInTheDocument()
    // Both Maria (HR+Manager) and Piotr (Manager) have the Manager badge → use getAllBy
    expect(screen.getAllByText('Manager').length).toBeGreaterThan(0)
  })

  it('shows invite button only for invited users', () => {
    render(<UsersTable users={getUsers()} />)
    const inviteButtons = screen.getAllByRole('button', { name: /Wyślij zaproszenie/ })
    expect(inviteButtons).toHaveLength(1) // only Anna (invited)
  })
})
