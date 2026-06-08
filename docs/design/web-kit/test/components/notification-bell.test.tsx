import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resetNotifications, getNotifications, getUnreadCount } from '@/lib/notifications'
import { NotificationBell } from '@/components/notifications/notification-bell'

beforeEach(() => {
  resetNotifications()
})

function renderBell(overrides?: { unreadCount?: number }) {
  const notifications = getNotifications({ limit: 5 })
  const unreadCount = overrides?.unreadCount ?? getUnreadCount()
  return render(<NotificationBell notifications={notifications} unreadCount={unreadCount} />)
}

describe('NotificationBell', () => {
  it('renders a bell icon button', () => {
    renderBell()
    const btn = screen.getByRole('button', { name: /powiadomienia/i })
    expect(btn).toBeInTheDocument()
  })

  it('shows unread count badge when count > 0', () => {
    renderBell()
    const count = getUnreadCount()
    expect(count).toBeGreaterThan(0)
    expect(screen.getByText(String(count))).toBeInTheDocument()
  })

  it('hides badge when unreadCount is 0', () => {
    render(<NotificationBell notifications={[]} unreadCount={0} />)
    // Badge should not be visible — count 0 is not rendered
    const badge = screen.queryByTestId('unread-badge')
    expect(badge).toBeNull()
  })

  it('opens dropdown on click and shows notification titles', async () => {
    const user = userEvent.setup()
    renderBell()
    const btn = screen.getByRole('button', { name: /powiadomienia/i })
    await user.click(btn)
    // At least the first notification's title should appear
    const notifications = getNotifications({ limit: 5 })
    expect(screen.getByText(notifications[0].title)).toBeInTheDocument()
  })

  it('shows all 5 notification titles in the dropdown', async () => {
    const user = userEvent.setup()
    renderBell()
    await user.click(screen.getByRole('button', { name: /powiadomienia/i }))
    const notifications = getNotifications({ limit: 5 })
    for (const n of notifications) {
      expect(screen.getByText(n.title)).toBeInTheDocument()
    }
  })

  it('shows "Oznacz wszystkie jako przeczytane" button when unreadCount > 0', async () => {
    const user = userEvent.setup()
    renderBell()
    await user.click(screen.getByRole('button', { name: /powiadomienia/i }))
    expect(screen.getByText(/oznacz wszystkie jako przeczytane/i)).toBeInTheDocument()
  })

  it('does not show "Oznacz wszystkie" when unreadCount is 0', async () => {
    const user = userEvent.setup()
    render(<NotificationBell notifications={getNotifications({ limit: 5 })} unreadCount={0} />)
    await user.click(screen.getByRole('button', { name: /powiadomienia/i }))
    expect(screen.queryByText(/oznacz wszystkie jako przeczytane/i)).toBeNull()
  })

  it('dropdown is not visible before clicking the bell', () => {
    renderBell()
    const notifications = getNotifications({ limit: 5 })
    // First notification title should NOT be visible before clicking
    expect(screen.queryByText(notifications[0].title)).toBeNull()
  })

  it('each notification row shows a priority dot', async () => {
    const user = userEvent.setup()
    renderBell()
    await user.click(screen.getByRole('button', { name: /powiadomienia/i }))
    const dots = screen.getAllByTestId('priority-dot')
    expect(dots.length).toBeGreaterThan(0)
  })
})
