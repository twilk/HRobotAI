import { NextResponse } from 'next/server'
import {
  getNotifications,
  addNotification,
  type NotificationType,
  type NotificationPriority,
} from '@/lib/notifications'

/** GET /api/notifications?unreadOnly=true&limit=5 */
export function GET(req: Request) {
  const url = new URL(req.url)
  const unreadOnly = url.searchParams.get('unreadOnly') === 'true'
  const limitParam = url.searchParams.get('limit')
  const limit = limitParam ? Number(limitParam) : undefined

  const notifications = getNotifications({
    ...(unreadOnly ? { unreadOnly: true } : {}),
    ...(limit !== undefined && limit > 0 ? { limit } : {}),
  })

  return NextResponse.json(notifications)
}

/** POST /api/notifications — create a new notification */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  const type = String(body.type ?? '').trim() as NotificationType
  const priority = String(body.priority ?? '').trim() as NotificationPriority
  const title = String(body.title ?? '').trim()
  const message = String(body.message ?? '').trim()

  if (!type || !priority || !title || !message) {
    return NextResponse.json({ error: 'type, priority, title and message are required' }, { status: 400 })
  }

  const created = addNotification({
    type,
    priority,
    title,
    message,
    ...(body.employeeId ? { employeeId: String(body.employeeId) } : {}),
    ...(body.employeeName ? { employeeName: String(body.employeeName) } : {}),
    ...(body.actionUrl ? { actionUrl: String(body.actionUrl) } : {}),
  })

  return NextResponse.json(created, { status: 201 })
}
