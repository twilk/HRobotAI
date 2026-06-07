import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LoginForm } from '@/components/auth/login-form'

vi.mock('next-auth/react', () => ({
  signIn: vi.fn().mockResolvedValue(undefined),
}))

import { signIn } from 'next-auth/react'

describe('LoginForm', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders sign-in button', () => {
    render(<LoginForm />)
    expect(screen.getByRole('button', { name: /zaloguj/i })).toBeInTheDocument()
  })

  it('calls signIn with keycloak provider on click', async () => {
    render(<LoginForm />)
    fireEvent.click(screen.getByRole('button', { name: /zaloguj/i }))
    expect(signIn).toHaveBeenCalledWith('keycloak', expect.objectContaining({ callbackUrl: '/dashboard' }))
  })

  it('uses provided callbackUrl prop', async () => {
    render(<LoginForm callbackUrl="/pracownicy" />)
    fireEvent.click(screen.getByRole('button', { name: /zaloguj/i }))
    expect(signIn).toHaveBeenCalledWith('keycloak', expect.objectContaining({ callbackUrl: '/pracownicy' }))
  })

  it('has no email or password input fields', () => {
    render(<LoginForm />)
    expect(screen.queryByRole('textbox', { name: /email/i })).toBeNull()
    expect(screen.queryByLabelText(/haslo/i)).toBeNull()
  })

  it('contains no hardcoded credentials in rendered output', () => {
    const { container } = render(<LoginForm />)
    expect(container.innerHTML).not.toMatch(/kowalski/i)
    expect(container.innerHTML).not.toMatch(/acme/i)
    expect(container.innerHTML).not.toMatch(/tajne/i)
  })
})
