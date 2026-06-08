import { NextResponse } from 'next/server'
import { markAllRead } from '@/lib/notifications'

/** POST /api/notifications/read-all — marks all unread notifications as read */
export function POST(_req: Request) {
  const markedRead = markAllRead()
  return NextResponse.json({ markedRead })
}
