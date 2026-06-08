import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UsersClientView } from '@/components/users/users-client-view'
import { getUsers } from '@/lib/users'

const users = getUsers()

describe('UsersClientView', () => {
  it('renders the users table', () => {
    render(<UsersClientView initialUsers={users} />)
    expect(screen.getByText('Jan Kowalski')).toBeInTheDocument()
    expect(screen.getByText('Maria Nowak')).toBeInTheDocument()
  })

  it('opens invite modal when Zaproś button clicked', async () => {
    const user = userEvent.setup()
    render(<UsersClientView initialUsers={users} />)
    await user.click(screen.getByRole('button', { name: /Zaproś użytkownika/ }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // Modal title rendered inside the dialog
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-labelledby', 'modal-title')
  })

  it('closes modal when Anuluj is clicked', async () => {
    const user = userEvent.setup()
    render(<UsersClientView initialUsers={users} />)
    await user.click(screen.getByRole('button', { name: /Zaproś użytkownika/ }))
    await user.click(screen.getByRole('button', { name: /Anuluj/ }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('adds invited user to list when form submitted', async () => {
    const user = userEvent.setup()
    render(<UsersClientView initialUsers={users} />)
    await user.click(screen.getByRole('button', { name: /Zaproś użytkownika/ }))
    const dialog = screen.getByRole('dialog')
    await user.type(screen.getByLabelText('Email'), 'nowy@acme.pl')
    // Scope to dialog to avoid ambiguity with table's "Wyślij zaproszenie" ghost buttons
    const { getByRole: dialogGetByRole } = { getByRole: (role: string, opts?: object) => screen.getAllByRole(role as 'button', opts as Parameters<typeof screen.getAllByRole>[1]).find(el => dialog.contains(el))! }
    await user.click(dialogGetByRole('button', { name: /Wyślij zaproszenie/ }))
    expect(screen.getByText('nowy@acme.pl')).toBeInTheDocument()
  })

  it('shows validation error for empty email', async () => {
    const user = userEvent.setup()
    render(<UsersClientView initialUsers={users} />)
    await user.click(screen.getByRole('button', { name: /Zaproś użytkownika/ }))
    const dialog = screen.getByRole('dialog')
    // Submit without typing anything
    const submitBtn = screen.getAllByRole('button', { name: /Wyślij zaproszenie/ }).find((el) => dialog.contains(el))!
    await user.click(submitBtn)
    expect(screen.getByRole('alert')).toHaveTextContent('Email jest wymagany')
    // Modal should still be open
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('shows validation error for invalid email format', async () => {
    const user = userEvent.setup()
    render(<UsersClientView initialUsers={users} />)
    await user.click(screen.getByRole('button', { name: /Zaproś użytkownika/ }))
    const dialog = screen.getByRole('dialog')
    await user.type(screen.getByLabelText('Email'), 'nie-to-nie-email')
    const submitBtn = screen.getAllByRole('button', { name: /Wyślij zaproszenie/ }).find((el) => dialog.contains(el))!
    await user.click(submitBtn)
    expect(screen.getByRole('alert')).toHaveTextContent('Podaj poprawny adres email')
    // Modal should still be open
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
