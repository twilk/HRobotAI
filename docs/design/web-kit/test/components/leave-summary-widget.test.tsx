import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { resetNotifications } from '@/lib/notifications'
import { resetLeaveBalances } from '@/lib/leave-balance'
import { LeaveSummaryWidget } from '@/components/wnioski/leave-summary-widget'
import type { LeaveRequest } from '@/lib/wnioski'
import type { LeaveBalance } from '@/lib/leave-balance'

beforeEach(() => {
  resetNotifications()
  resetLeaveBalances()
})

const pendingRequests: LeaveRequest[] = [
  {
    id: 'wr-p1',
    employeeId: '1',
    employeeName: 'Anna Nowak',
    type: 'urlop-wypoczynkowy',
    status: 'pending',
    dateFrom: '2026-08-01',
    dateTo: '2026-08-05',
    days: 5,
    requestedAt: '2026-06-01T10:00:00.000Z',
  },
  {
    id: 'wr-p2',
    employeeId: '3',
    employeeName: 'Katarzyna Wójcik',
    type: 'urlop-wypoczynkowy',
    status: 'pending',
    dateFrom: '2026-08-04',
    dateTo: '2026-08-08',
    days: 5,
    requestedAt: '2026-06-05T09:15:00.000Z',
  },
]

const approvedThisMonth: LeaveRequest[] = [
  {
    id: 'wr-a1',
    employeeId: '1',
    employeeName: 'Anna Nowak',
    type: 'urlop-wypoczynkowy',
    status: 'approved',
    dateFrom: '2026-06-01',
    dateTo: '2026-06-05',
    days: 5,
    requestedAt: '2026-05-20T08:00:00.000Z',
    approvedAt: '2026-06-01T10:00:00.000Z',
    approvedBy: 'Jan Kowalski',
  },
]

const dangerZoneBalances: LeaveBalance[] = [
  {
    id: 'lb-4-2026',
    employeeId: '4',
    employeeName: 'Tomasz Kamiński',
    year: 2026,
    urlop_wypoczynkowy: { entitled: 26, used: 24, remaining: 2 },
    urlop_ojcowski: { entitled: 14, used: 0, remaining: 14 },
    inne: { entitled: 10, used: 8, remaining: 2 },
  },
]

const safeBalances: LeaveBalance[] = [
  {
    id: 'lb-1-2026',
    employeeId: '1',
    employeeName: 'Anna Nowak',
    year: 2026,
    urlop_wypoczynkowy: { entitled: 26, used: 10, remaining: 16 },
    urlop_ojcowski: { entitled: 14, used: 0, remaining: 14 },
    inne: { entitled: 10, used: 3, remaining: 7 },
  },
]

describe('LeaveSummaryWidget', () => {
  it('shows pending requests count', () => {
    render(
      <LeaveSummaryWidget
        pendingCount={pendingRequests.length}
        approvedThisMonthCount={approvedThisMonth.length}
        dangerZoneEmployees={dangerZoneBalances}
      />
    )
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText(/oczekujące/i)).toBeInTheDocument()
  })

  it('shows this-month approved count', () => {
    render(
      <LeaveSummaryWidget
        pendingCount={pendingRequests.length}
        approvedThisMonthCount={approvedThisMonth.length}
        dangerZoneEmployees={dangerZoneBalances}
      />
    )
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText(/zatwierdzone/i)).toBeInTheDocument()
  })

  it('shows employees in danger zone (< 5 days remaining)', () => {
    render(
      <LeaveSummaryWidget
        pendingCount={0}
        approvedThisMonthCount={0}
        dangerZoneEmployees={dangerZoneBalances}
      />
    )
    expect(screen.getByText(/Tomasz Kamiński/)).toBeInTheDocument()
  })

  it('shows empty danger zone message when no employees in danger zone', () => {
    render(
      <LeaveSummaryWidget
        pendingCount={0}
        approvedThisMonthCount={0}
        dangerZoneEmployees={[]}
      />
    )
    expect(screen.getByText(/wszyscy pracownicy/i)).toBeInTheDocument()
  })

  it('has a link to wnioski page for pending requests', () => {
    render(
      <LeaveSummaryWidget
        pendingCount={2}
        approvedThisMonthCount={0}
        dangerZoneEmployees={[]}
      />
    )
    const link = screen.getByRole('link', { name: /wnioski/i })
    expect(link).toHaveAttribute('href', '/wnioski')
  })

  it('renders a section heading', () => {
    render(
      <LeaveSummaryWidget
        pendingCount={0}
        approvedThisMonthCount={0}
        dangerZoneEmployees={[]}
      />
    )
    expect(screen.getByText(/urlopy/i)).toBeInTheDocument()
  })
})
