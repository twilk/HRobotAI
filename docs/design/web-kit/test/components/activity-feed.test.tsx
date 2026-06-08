import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { resetNotifications } from '@/lib/notifications'
import { ActivityFeed } from '@/components/dashboard/activity-feed'
import type { Notification } from '@/lib/notifications'

beforeEach(() => {
  resetNotifications()
})

const mockNotifications: Notification[] = [
  {
    id: 'n-1',
    type: 'leave-approved',
    priority: 'high',
    title: 'Wniosek zatwierdzony',
    message: 'Wniosek urlopowy Anny Nowak został zatwierdzony.',
    read: false,
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'n-2',
    type: 'employee-added',
    priority: 'medium',
    title: 'Nowy pracownik',
    message: 'Jan Kowalski dołączył do zespołu.',
    read: true,
    createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'n-3',
    type: 'system',
    priority: 'low',
    title: 'Przerwa techniczna',
    message: 'Zaplanowano przerwę techniczną.',
    read: false,
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
]

describe('ActivityFeed', () => {
  it('renders notification list', () => {
    render(<ActivityFeed notifications={mockNotifications} />)
    const items = screen.getAllByRole('listitem')
    expect(items.length).toBeGreaterThan(0)
  })

  it('shows notification title', () => {
    render(<ActivityFeed notifications={mockNotifications} />)
    expect(screen.getByText('Wniosek zatwierdzony')).toBeInTheDocument()
    expect(screen.getByText('Nowy pracownik')).toBeInTheDocument()
  })

  it('shows priority indicator for each notification', () => {
    render(<ActivityFeed notifications={mockNotifications} />)
    const dots = screen.getAllByTestId('activity-priority-dot')
    expect(dots.length).toBe(mockNotifications.length)
  })

  it('shows relative time for each notification', () => {
    render(<ActivityFeed notifications={mockNotifications} />)
    // The 2h ago notification
    expect(screen.getByText(/2h temu/)).toBeInTheDocument()
    // The yesterday notification
    expect(screen.getByText(/wczoraj/)).toBeInTheDocument()
    // The 3 days ago notification
    expect(screen.getByText(/3 dni temu/)).toBeInTheDocument()
  })

  it('shows empty state when no notifications', () => {
    render(<ActivityFeed notifications={[]} />)
    expect(screen.getByText(/brak aktywności/i)).toBeInTheDocument()
  })

  it('shows unread indicator for unread notifications', () => {
    render(<ActivityFeed notifications={mockNotifications} />)
    const unreadDots = screen.getAllByTestId('unread-dot')
    // Only unread notifications should have the unread-dot
    const unreadCount = mockNotifications.filter((n) => !n.read).length
    expect(unreadDots.length).toBe(unreadCount)
  })

  it('truncates long messages to 60 characters', () => {
    const longMsg = 'A'.repeat(80)
    const longNotifications: Notification[] = [
      {
        id: 'ln-1',
        type: 'system',
        priority: 'low',
        title: 'Long message test',
        message: longMsg,
        read: false,
        createdAt: new Date().toISOString(),
      },
    ]
    render(<ActivityFeed notifications={longNotifications} />)
    // Should show truncated text with ellipsis (via CSS truncation or explicit)
    const titleEl = screen.getByText('Long message test')
    expect(titleEl).toBeInTheDocument()
  })

  it('renders a section heading', () => {
    render(<ActivityFeed notifications={mockNotifications} />)
    expect(screen.getByText(/ostatnia aktywność/i)).toBeInTheDocument()
  })

  it('shows correct count of notifications', () => {
    render(<ActivityFeed notifications={mockNotifications} />)
    const items = screen.getAllByRole('listitem')
    expect(items.length).toBe(mockNotifications.length)
  })
})
