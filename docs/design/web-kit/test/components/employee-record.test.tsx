import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmployeeRecord } from '@/components/employees/employee-record'
import { getEmployee } from '@/lib/employees'

describe('EmployeeRecord — audited PESEL reveal', () => {
  it('renders every section with a masked PESEL', () => {
    const e = getEmployee('3')!
    render(<EmployeeRecord employee={e} actor="Jan Kowalski" />)
    // Section titles share words with the anchor nav, so assert on the headings.
    const headings = screen.getAllByRole('heading').map((h) => h.textContent ?? '')
    for (const s of ['Dane podstawowe', 'Umowa', 'Grafik', 'Wnioski', 'Dziennik audytu']) {
      expect(headings.some((h) => h.startsWith(s))).toBe(true)
    }
    expect(screen.getByText(`•••••••${e.peselLast4}`)).toBeInTheDocument()
  })

  it('reveal requires confirmation and writes an audit entry (reveal → logged → visible)', async () => {
    const user = userEvent.setup()
    const e = getEmployee('3')! // seed audit has no "Ujawniono PESEL"
    render(<EmployeeRecord employee={e} actor="Jan Kowalski" />)

    expect(screen.queryByText('Ujawniono PESEL')).toBeNull()

    // masked → confirm
    await user.click(screen.getByRole('button', { name: /Ujawnij i zapisz wpis/i }))
    expect(screen.getByText(/z Twoim imieniem, czasem i adresem IP/i)).toBeInTheDocument()

    // confirm → revealed + new audit row
    await user.click(screen.getByRole('button', { name: /Ujawnij i zapisz wpis/i }))
    expect(screen.getByText('Zapisano wpis w dzienniku audytu')).toBeInTheDocument()
    expect(screen.getByText('Ujawniono PESEL')).toBeInTheDocument()
  })

  it('lets the user cancel the reveal without logging', async () => {
    const user = userEvent.setup()
    const e = getEmployee('4')!
    render(<EmployeeRecord employee={e} actor="Jan Kowalski" />)
    await user.click(screen.getByRole('button', { name: /Ujawnij i zapisz wpis/i }))
    await user.click(screen.getByRole('button', { name: /Anuluj/i }))
    expect(screen.queryByText('Ujawniono PESEL')).toBeNull()
    expect(screen.getByRole('button', { name: /Ujawnij i zapisz wpis/i })).toBeInTheDocument()
  })
})
