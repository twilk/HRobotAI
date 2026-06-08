import { describe, it, expect, beforeEach } from 'vitest'
import {
  getNotifications,
  getNotification,
  addNotification,
  markRead,
  markAllRead,
  getUnreadCount,
  resetNotifications,
  type Notification,
  type NotificationType,
  type NotificationPriority,
} from '@/lib/notifications'

beforeEach(() => {
  resetNotifications()
})

describe('getNotifications', () => {
  it('returns all notifications sorted by createdAt descending', () => {
    const all = getNotifications()
    expect(all.length).toBeGreaterThanOrEqual(8)
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1].createdAt >= all[i].createdAt).toBe(true)
    }
  })

  it('returns only unread when unreadOnly: true', () => {
    const unread = getNotifications({ unreadOnly: true })
    expect(unread.every((n) => !n.read)).toBe(true)
    expect(unread.length).toBeGreaterThan(0)
  })

  it('returns at most limit results when limit is set', () => {
    const limited = getNotifications({ limit: 3 })
    expect(limited.length).toBeLessThanOrEqual(3)
  })

  it('returns correct number when both unreadOnly and limit are set', () => {
    const result = getNotifications({ unreadOnly: true, limit: 2 })
    expect(result.length).toBeLessThanOrEqual(2)
    expect(result.every((n) => !n.read)).toBe(true)
  })
})

describe('getNotification', () => {
  it('returns the notification by id', () => {
    const all = getNotifications()
    const first = all[0]
    const found = getNotification(first.id)
    expect(found).toBeDefined()
    expect(found?.id).toBe(first.id)
  })

  it('returns undefined for unknown id', () => {
    expect(getNotification('does-not-exist')).toBeUndefined()
  })
})

describe('addNotification', () => {
  it('adds notification to store and returns with id, read=false, createdAt', () => {
    const before = getNotifications().length
    const created = addNotification({
      type: 'employee-added',
      priority: 'medium',
      title: 'Nowy pracownik',
      message: 'Dodano nowego pracownika do systemu.',
      employeeId: 'emp-99',
      employeeName: 'Test User',
      actionUrl: '/pracownicy',
    })
    expect(created.id).toBeTruthy()
    expect(created.read).toBe(false)
    expect(created.createdAt).toBeTruthy()
    expect(new Date(created.createdAt).toISOString()).toBe(created.createdAt)
    expect(getNotifications().length).toBe(before + 1)
  })

  it('newly added notification is retrievable by id', () => {
    const created = addNotification({
      type: 'system',
      priority: 'low',
      title: 'Komunikat systemowy',
      message: 'Zaplanowano przerwę techniczną.',
    })
    expect(getNotification(created.id)).toBeDefined()
  })

  it('newly added notification appears first (sorted by createdAt desc)', () => {
    const created = addNotification({
      type: 'shift-assigned',
      priority: 'medium',
      title: 'Zmiana przypisana',
      message: 'Przypisano nową zmianę.',
    })
    const all = getNotifications()
    expect(all[0].id).toBe(created.id)
  })
})

describe('markRead', () => {
  it('marks a notification as read and returns true', () => {
    const unread = getNotifications({ unreadOnly: true })
    expect(unread.length).toBeGreaterThan(0)
    const target = unread[0]
    const result = markRead(target.id)
    expect(result).toBe(true)
    expect(getNotification(target.id)?.read).toBe(true)
  })

  it('returns false for unknown id', () => {
    expect(markRead('nonexistent')).toBe(false)
  })

  it('already-read notification stays read after markRead', () => {
    const all = getNotifications()
    const alreadyRead = all.find((n) => n.read)
    expect(alreadyRead).toBeDefined()
    const result = markRead(alreadyRead!.id)
    expect(result).toBe(true)
    expect(getNotification(alreadyRead!.id)?.read).toBe(true)
  })
})

describe('markAllRead', () => {
  it('marks all unread notifications and returns the count', () => {
    const countBefore = getUnreadCount()
    expect(countBefore).toBeGreaterThan(0)
    const marked = markAllRead()
    expect(marked).toBe(countBefore)
    expect(getUnreadCount()).toBe(0)
  })

  it('returns 0 when all are already read', () => {
    markAllRead() // first pass
    const second = markAllRead()
    expect(second).toBe(0)
  })
})

describe('getUnreadCount', () => {
  it('returns the correct number of unread notifications', () => {
    const unreadList = getNotifications({ unreadOnly: true })
    expect(getUnreadCount()).toBe(unreadList.length)
  })

  it('decreases by 1 after markRead on an unread item', () => {
    const before = getUnreadCount()
    const unread = getNotifications({ unreadOnly: true })
    markRead(unread[0].id)
    expect(getUnreadCount()).toBe(before - 1)
  })

  it('is 0 after markAllRead', () => {
    markAllRead()
    expect(getUnreadCount()).toBe(0)
  })
})

describe('resetNotifications', () => {
  it('restores seed data after mutations', () => {
    markAllRead()
    addNotification({ type: 'system', priority: 'low', title: 'X', message: 'Y' })
    resetNotifications()
    const all = getNotifications()
    expect(all.length).toBeGreaterThanOrEqual(8)
    expect(getUnreadCount()).toBeGreaterThan(0)
  })
})

describe('type safety', () => {
  it('notification types include all expected values', () => {
    const types: NotificationType[] = [
      'leave-approved',
      'leave-rejected',
      'leave-new-request',
      'access-changed',
      'employee-added',
      'employee-status-changed',
      'shift-assigned',
      'system',
    ]
    expect(types.length).toBe(8)
  })

  it('priority values are valid', () => {
    const priorities: NotificationPriority[] = ['low', 'medium', 'high']
    expect(priorities.length).toBe(3)
  })
})
