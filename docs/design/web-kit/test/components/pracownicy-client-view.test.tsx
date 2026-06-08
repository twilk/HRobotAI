import { describe, it, expect, vi, beforeEach } from 'vitest'
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

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/lib/actions/employees-actions', () => ({
  editEmployee: vi.fn().mockResolvedValue({ success: true }),
  changeEmployeeStatus: vi.fn().mockResolvedValue({ success: true }),
  addNewEmployee: vi.fn().mockResolvedValue({ success: true, employee: { id: 'mock-1' } }),
}))

vi.mock('@/lib/actions/onboarding-actions', () => ({
  onboardNewEmployee: vi.fn().mockResolvedValue({ success: true, employeeId: 'onboard-mock-1' }),
}))

import { PracownicyClientView } from '@/components/employees/pracownicy-client-view'
import { getEmployees, resetEmployees } from '@/lib/employees'

beforeEach(() => {
  resetEmployees()
  vi.clearAllMocks()
})

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

  it('shows validation error when firstName is empty', async () => {
    const user = userEvent.setup()
    render(<PracownicyClientView initialEmployees={employees} />)
    await user.click(screen.getByRole('button', { name: /Dodaj pracownika/ }))
    // Submit without filling any field
    await user.click(screen.getByRole('button', { name: /Zapisz/ }))
    expect(screen.getByText('Imię jest wymagane')).toBeInTheDocument()
  }, 15_000)

  it('shows toast.success after valid employee added', async () => {
    const toast = await import('react-hot-toast')
    const user = userEvent.setup()
    render(<PracownicyClientView initialEmployees={employees} />)
    await user.click(screen.getByRole('button', { name: /Dodaj pracownika/ }))
    await user.type(screen.getByLabelText('Imię'), 'Marek')
    await user.type(screen.getByLabelText('Nazwisko'), 'Toastowy')
    await user.type(screen.getByLabelText('Email'), 'm.toastowy@acme.pl')
    await user.type(screen.getByLabelText('Stanowisko'), 'Dev')
    await user.type(screen.getByLabelText('Jednostka'), 'IT')
    await user.click(screen.getByRole('button', { name: /Zapisz/ }))
    expect(toast.default.success).toHaveBeenCalledWith('Pracownik dodany')
  }, 15_000)

  it('calls onboardNewEmployee when add-employee form is submitted', async () => {
    const { onboardNewEmployee } = await import('@/lib/actions/onboarding-actions')
    const user = userEvent.setup()
    render(<PracownicyClientView initialEmployees={employees} />)
    await user.click(screen.getByRole('button', { name: /Dodaj pracownika/ }))
    await user.type(screen.getByLabelText('Imię'), 'Zofia')
    await user.type(screen.getByLabelText('Nazwisko'), 'Onboard')
    await user.type(screen.getByLabelText('Email'), 'z.onboard@acme.pl')
    await user.type(screen.getByLabelText('Stanowisko'), 'Dev')
    await user.type(screen.getByLabelText('Jednostka'), 'IT')
    await user.click(screen.getByRole('button', { name: /Zapisz/ }))
    expect(onboardNewEmployee).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Zofia Onboard',
        email: 'z.onboard@acme.pl',
        position: 'Dev',
        department: 'IT',
      }),
    )
  }, 15_000)

  it('does not call onboardNewEmployee when validation fails', async () => {
    const { onboardNewEmployee } = await import('@/lib/actions/onboarding-actions')
    const user = userEvent.setup()
    render(<PracownicyClientView initialEmployees={employees} />)
    await user.click(screen.getByRole('button', { name: /Dodaj pracownika/ }))
    // Submit without filling any required field
    await user.click(screen.getByRole('button', { name: /Zapisz/ }))
    expect(onboardNewEmployee).not.toHaveBeenCalled()
  }, 15_000)
})

describe('PracownicyClientView — EditEmployeeModal', () => {
  it('shows Edit button for each employee row', () => {
    render(<PracownicyClientView initialEmployees={employees} />)
    const editButtons = screen.getAllByRole('button', { name: /Edytuj/ })
    expect(editButtons.length).toBeGreaterThanOrEqual(employees.length)
  })

  it('clicking Edit opens the modal with the correct employee name pre-filled', async () => {
    const user = userEvent.setup()
    render(<PracownicyClientView initialEmployees={employees} />)
    const editButtons = screen.getAllByRole('button', { name: /Edytuj/ })
    await user.click(editButtons[0])
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    // The first employee is Anna Nowak — her firstName should be pre-filled
    const firstNameInput = screen.getByLabelText('Imię') as HTMLInputElement
    expect(firstNameInput.value).toBe('Anna')
  }, 15_000)

  it('submitting edit form calls editEmployee action', async () => {
    const { editEmployee } = await import('@/lib/actions/employees-actions')
    const user = userEvent.setup()
    render(<PracownicyClientView initialEmployees={employees} />)
    const editButtons = screen.getAllByRole('button', { name: /Edytuj/ })
    await user.click(editButtons[0])
    // Submit the form as-is
    await user.click(screen.getByRole('button', { name: /Zapisz zmiany/ }))
    expect(editEmployee).toHaveBeenCalled()
  }, 15_000)

  it('changing status dropdown and saving calls changeEmployeeStatus action', async () => {
    const { changeEmployeeStatus } = await import('@/lib/actions/employees-actions')
    const user = userEvent.setup()
    render(<PracownicyClientView initialEmployees={employees} />)
    const editButtons = screen.getAllByRole('button', { name: /Edytuj/ })
    await user.click(editButtons[0])
    const statusSelect = screen.getByLabelText('Status') as HTMLSelectElement
    await user.selectOptions(statusSelect, 'inactive')
    await user.click(screen.getByRole('button', { name: /Zapisz zmiany/ }))
    expect(changeEmployeeStatus).toHaveBeenCalledWith(expect.any(String), 'inactive', expect.any(String))
  }, 15_000)
})
