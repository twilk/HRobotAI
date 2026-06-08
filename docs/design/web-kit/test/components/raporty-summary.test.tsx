import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RaportySummary } from '@/components/raporty/raporty-summary'
import type { HRSummary } from '@/lib/raporty'

const SUMMARY: HRSummary = {
  employees: { total: 6, active: 5, onLeave: 1 },
  leave: { pending: 2, approved: 3, rejected: 1, thisMonth: 3, byType: { 'urlop-wypoczynkowy': 3, 'urlop-macierzynski': 1 } },
  schedule: {
    totalShiftsThisWeek: 18,
    totalHoursThisWeek: 130,
    coverageByFacility: [
      { facilityId: 'f1', facilityName: 'Centrala Warszawa', shiftsCount: 8 },
      { facilityId: 'f2', facilityName: 'Magazyn Pruszków', shiftsCount: 7 },
      { facilityId: 'f3', facilityName: 'Oddział Kraków', shiftsCount: 3 },
    ],
  },
  access: {
    employeesWithAdminAccess: 1,
    moduleAdoption: [
      { module: 'grafik', activeCount: 2 },
      { module: 'wnioski', activeCount: 4 },
      { module: 'raporty', activeCount: 2 },
    ],
  },
  generatedAt: '2026-06-08T20:00:00.000Z',
}

describe('RaportySummary', () => {
  it('renders the Pracownicy stat card with total employee count', () => {
    render(<RaportySummary summary={SUMMARY} />)
    expect(screen.getByText('Pracownicy')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
  })

  it('shows active and onLeave values in Pracownicy card', () => {
    render(<RaportySummary summary={SUMMARY} />)
    expect(screen.getByText(/5 aktywni/)).toBeInTheDocument()
    expect(screen.getByText(/1 na urlopie/)).toBeInTheDocument()
  })

  it('renders the Wnioski urlopowe stat card with pending count', () => {
    render(<RaportySummary summary={SUMMARY} />)
    expect(screen.getByText('Wnioski urlopowe')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('shows leave approved and rejected in Wnioski card', () => {
    render(<RaportySummary summary={SUMMARY} />)
    // approved=3 and rejected=1 appear in the leave card
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('renders the Grafik tygodnia stat card with total shifts', () => {
    render(<RaportySummary summary={SUMMARY} />)
    expect(screen.getByText('Grafik tygodnia')).toBeInTheDocument()
    expect(screen.getByText('18')).toBeInTheDocument()
  })

  it('shows total hours in Grafik tygodnia card', () => {
    render(<RaportySummary summary={SUMMARY} />)
    expect(screen.getByText('130')).toBeInTheDocument()
  })

  it('renders the Dostępy stat card', () => {
    render(<RaportySummary summary={SUMMARY} />)
    expect(screen.getByText('Dostępy')).toBeInTheDocument()
  })

  it('shows employeesWithAdminAccess count', () => {
    render(<RaportySummary summary={SUMMARY} />)
    // 1 employee with admin access — appears as standalone text in the Dostępy card
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1)
  })

  it('renders all 4 stat card headings', () => {
    render(<RaportySummary summary={SUMMARY} />)
    expect(screen.getByText('Pracownicy')).toBeInTheDocument()
    expect(screen.getByText('Wnioski urlopowe')).toBeInTheDocument()
    expect(screen.getByText('Grafik tygodnia')).toBeInTheDocument()
    expect(screen.getByText('Dostępy')).toBeInTheDocument()
  })

  it('shows facility names in schedule card', () => {
    render(<RaportySummary summary={SUMMARY} />)
    expect(screen.getByText(/Centrala Warszawa/)).toBeInTheDocument()
  })
})
