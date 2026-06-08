// In-memory notifications store for the HRobot web-kit reference app.
// In a real app this would come from the authenticated tenant runtime.

export type NotificationType =
  | 'leave-approved'
  | 'leave-rejected'
  | 'leave-new-request'
  | 'access-changed'
  | 'employee-added'
  | 'employee-status-changed'
  | 'shift-assigned'
  | 'system'

export type NotificationPriority = 'low' | 'medium' | 'high'

export interface Notification {
  id: string
  type: NotificationType
  priority: NotificationPriority
  title: string
  message: string
  employeeId?: string
  employeeName?: string
  read: boolean
  createdAt: string  // ISO
  actionUrl?: string // e.g. '/wnioski', '/pracownicy/[id]'
}

// Seed data — 8 notifications of different types, some read, some unread
const SEED_NOTIFICATIONS: Notification[] = [
  {
    id: 'notif-1',
    type: 'leave-approved',
    priority: 'high',
    title: 'Wniosek urlopowy zatwierdzony',
    message: 'Wniosek urlopowy Anny Nowak (10 dni, 1–14 VII) został zatwierdzony.',
    employeeId: '1',
    employeeName: 'Anna Nowak',
    read: false,
    createdAt: '2026-06-08T10:15:00.000Z',
    actionUrl: '/wnioski',
  },
  {
    id: 'notif-2',
    type: 'leave-rejected',
    priority: 'high',
    title: 'Wniosek urlopowy odrzucony',
    message: 'Wniosek Piotra Wiśniewskiego został odrzucony z powodu braku pokrycia kadry.',
    employeeId: '2',
    employeeName: 'Piotr Wiśniewski',
    read: false,
    createdAt: '2026-06-08T09:45:00.000Z',
    actionUrl: '/wnioski',
  },
  {
    id: 'notif-3',
    type: 'leave-new-request',
    priority: 'medium',
    title: 'Nowy wniosek urlopowy',
    message: 'Katarzyna Lis złożyła wniosek o urlop wypoczynkowy na 5 dni.',
    employeeId: '3',
    employeeName: 'Katarzyna Lis',
    read: false,
    createdAt: '2026-06-07T14:30:00.000Z',
    actionUrl: '/wnioski',
  },
  {
    id: 'notif-4',
    type: 'employee-added',
    priority: 'medium',
    title: 'Nowy pracownik dodany',
    message: 'Marek Kowalczyk dołączył do zespołu Obsługi Klienta.',
    employeeId: '10',
    employeeName: 'Marek Kowalczyk',
    read: true,
    createdAt: '2026-06-07T08:00:00.000Z',
    actionUrl: '/pracownicy',
  },
  {
    id: 'notif-5',
    type: 'access-changed',
    priority: 'high',
    title: 'Zmiana uprawnień dostępu',
    message: 'Uprawnienia Joanny Dąbrowskiej zostały zaktualizowane — dodano rola Manager.',
    employeeId: '4',
    employeeName: 'Joanna Dąbrowska',
    read: true,
    createdAt: '2026-06-06T16:20:00.000Z',
    actionUrl: '/dostepy',
  },
  {
    id: 'notif-6',
    type: 'employee-status-changed',
    priority: 'medium',
    title: 'Zmiana statusu pracownika',
    message: 'Status pracownika Tomasza Wróbla zmieniono na "Nieaktywny".',
    employeeId: '5',
    employeeName: 'Tomasz Wróbel',
    read: false,
    createdAt: '2026-06-06T11:00:00.000Z',
    actionUrl: '/pracownicy',
  },
  {
    id: 'notif-7',
    type: 'shift-assigned',
    priority: 'low',
    title: 'Przypisana zmiana w grafiku',
    message: 'Agnieszka Krawczyk została przypisana do zmiany nocnej (12–13 VI).',
    employeeId: '6',
    employeeName: 'Agnieszka Krawczyk',
    read: true,
    createdAt: '2026-06-05T17:45:00.000Z',
    actionUrl: '/grafik',
  },
  {
    id: 'notif-8',
    type: 'system',
    priority: 'low',
    title: 'Przerwa techniczna',
    message: 'Zaplanowano przerwę techniczną systemu w sobotę 13 VI od 2:00 do 4:00.',
    read: true,
    createdAt: '2026-06-05T09:00:00.000Z',
  },
]

// Mutable in-memory store — resets on module reload or resetNotifications()
let _store: Notification[] = SEED_NOTIFICATIONS.map((n) => ({ ...n }))
let _nextId = 100

function _sorted(list: Notification[]): Notification[] {
  return [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
}

/** Returns notifications sorted by createdAt descending. */
export function getNotifications(options?: { unreadOnly?: boolean; limit?: number }): Notification[] {
  let result = _sorted(_store)
  if (options?.unreadOnly) {
    result = result.filter((n) => !n.read)
  }
  if (options?.limit !== undefined && options.limit > 0) {
    result = result.slice(0, options.limit)
  }
  return result
}

/** Returns a single notification by id, or undefined. */
export function getNotification(id: string): Notification | undefined {
  return _store.find((n) => n.id === id)
}

/** Adds a notification to the store and returns the created record. */
export function addNotification(data: Omit<Notification, 'id' | 'read' | 'createdAt'>): Notification {
  const notification: Notification = {
    ...data,
    id: `notif-${++_nextId}`,
    read: false,
    createdAt: new Date().toISOString(),
  }
  _store.push(notification)
  return notification
}

/** Marks a notification as read. Returns true on success, false if not found. */
export function markRead(id: string): boolean {
  const n = _store.find((n) => n.id === id)
  if (!n) return false
  n.read = true
  return true
}

/** Marks all unread notifications as read. Returns the number that were marked. */
export function markAllRead(): number {
  const unread = _store.filter((n) => !n.read)
  unread.forEach((n) => { n.read = true })
  return unread.length
}

/** Returns the number of unread notifications. */
export function getUnreadCount(): number {
  return _store.filter((n) => !n.read).length
}

/** Resets the store to seed data — for test isolation. */
export function resetNotifications(): void {
  _store = SEED_NOTIFICATIONS.map((n) => ({ ...n }))
  _nextId = 100
}
