import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatsPanel } from '@/components/dashboard/stats-panel'
import type { HRSummary } from '@/lib/raporty'

const SUMMARY: HRSummary = {
  employees: { total: 12, active: 10, onLeave: 2 },
  leave: { pending: 3, approved: 5, rejected: 1, thisMonth: 6, byType: { 'urlop-wypoczynkowy': 5, 'urlop-okolicznosciowy': 1 } },
  schedule: {
    totalShiftsThisWeek: 24,
    totalHoursThisWeek: 180,
    coverageByFacility: [
      { facilityId: 'f1', facilityName: 'Centrala Warszawa', shiftsCount: 14 },
      { facilityId: 'f2', facilityName: 'Magazyn Pruszków', shiftsCount: 10 },
    ],
  },
  access: {
    employeesWithAdminAccess: 4,
    moduleAdoption: [
      { module: 'grafik', activeCount: 8 },
      { module: 'wnioski', activeCount: 10 },
    ],
  },
  generatedAt: '2026-06-08T10:00:00.000Z',
}

describe('StatsPanel', () => {
  it('renders the Pracownicy card heading', () => {
    render(<StatsPanel summary={SUMMARY} />)
    expect(screen.getByText('Pracownicy')).toBeInTheDocument()
  })

  it('shows total employees count', () => {
    render(<StatsPanel summary={SUMMARY} />)
    expect(screen.getByTestId('stat-employees-total')).toHaveTextContent('12')
  })

  it('shows active employees count within Pracownicy card', () => {
    render(<StatsPanel summary={SUMMARY} />)
    expect(screen.getByText(/10 aktywnych/)).toBeInTheDocument()
  })

  it('renders the Wnioski card heading', () => {
    render(<StatsPanel summary={SUMMARY} />)
    expect(screen.getByText('Wnioski')).toBeInTheDocument()
  })

  it('shows pending leave requests with amber badge', () => {
    render(<StatsPanel summary={SUMMARY} />)
    expect(screen.getByTestId('stat-leave-pending')).toHaveTextContent('3')
    // amber badge should be visible (warn tone renders text "oczekujące")
    expect(screen.getByText(/oczekujące/)).toBeInTheDocument()
  })

  it('renders the Grafik card heading', () => {
    render(<StatsPanel summary={SUMMARY} />)
    expect(screen.getByText('Grafik')).toBeInTheDocument()
  })

  it('shows total shifts this week', () => {
    render(<StatsPanel summary={SUMMARY} />)
    expect(screen.getByTestId('stat-shifts-week')).toHaveTextContent('24')
  })

  it('shows zmian w tygodniu label', () => {
    render(<StatsPanel summary={SUMMARY} />)
    expect(screen.getByText(/zmian w tygodniu/)).toBeInTheDocument()
  })

  it('renders the Dostępy admin card heading', () => {
    render(<StatsPanel summary={SUMMARY} />)
    expect(screen.getByText('Dostępy admin')).toBeInTheDocument()
  })

  it('shows employees with admin access count', () => {
    render(<StatsPanel summary={SUMMARY} />)
    expect(screen.getByTestId('stat-admin-access')).toHaveTextContent('4')
  })

  it('shows pracowników z dostępem admin label', () => {
    render(<StatsPanel summary={SUMMARY} />)
    expect(screen.getByText(/pracowników z dostępem admin/)).toBeInTheDocument()
  })

  it('renders all 4 stat cards', () => {
    render(<StatsPanel summary={SUMMARY} />)
    expect(screen.getByText('Pracownicy')).toBeInTheDocument()
    expect(screen.getByText('Wnioski')).toBeInTheDocument()
    expect(screen.getByText('Grafik')).toBeInTheDocument()
    expect(screen.getByText('Dostępy admin')).toBeInTheDocument()
  })
})
