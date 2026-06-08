import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FacilityConfig } from '@/components/facilities/facility-config'
import { getFacilities } from '@/lib/facilities'

describe('FacilityConfig (Placówki)', () => {
  it('renders each placówka with address + weekly total', () => {
    render(<FacilityConfig facilities={getFacilities()} />)
    expect(screen.getByText('Centrala Warszawa')).toBeInTheDocument()
    expect(screen.getByText('ul. Prosta 12')).toBeInTheDocument()
    expect(screen.getByText('44 h')).toBeInTheDocument() // f1 Pon–Pt 8h×5 + Sob 4h
  })

  it('toggles a day to Zamknięte and the weekly total drops', async () => {
    const user = userEvent.setup()
    render(<FacilityConfig facilities={getFacilities()} />)
    // checkbox order = f1 Pon..Nd (0..6); index 5 = f1 Sobota (open 9–13 = 4h)
    await user.click(screen.getAllByRole('checkbox')[5])
    expect(screen.queryByText('44 h')).toBeNull()
    expect(screen.getByText('40 h')).toBeInTheDocument()
  })
})
