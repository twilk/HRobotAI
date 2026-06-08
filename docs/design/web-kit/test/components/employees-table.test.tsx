import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

import { EmployeesTable } from '@/components/employees/employees-table'
import { getEmployees } from '@/lib/employees'

describe('EmployeesTable', () => {
  it('renders rows and masks PESEL to the last 4 digits', () => {
    render(<EmployeesTable employees={getEmployees()} />)
    expect(screen.getByText('Anna Nowak')).toBeInTheDocument()
    expect(screen.getByText('•••••••4821')).toBeInTheDocument()
    // never render an 11-digit plaintext PESEL
    expect(document.body.textContent ?? '').not.toMatch(/\d{11}/)
  })

  it('links each row to its detail route', () => {
    render(<EmployeesTable employees={getEmployees()} />)
    const link = screen.getByRole('link', { name: /Anna Nowak/i })
    expect(link).toHaveAttribute('href', '/pracownicy/1')
  })
})
