'use client'

import { useState } from 'react'
import { IconBell } from '@/components/icons'
import type { Notification, NotificationPriority } from '@/lib/notifications'

export interface NotificationBellProps {
  notifications: Notification[]
  unreadCount: number
}

function priorityDotClass(priority: NotificationPriority): string {
  if (priority === 'high') return 'bg-red-500'
  if (priority === 'medium') return 'bg-amber-400'
  return 'bg-blue-400'
}

function relativeTime(isoDate: string): string {
  const now = Date.now()
  const then = new Date(isoDate).getTime()
  const diffMs = now - then
  const diffH = Math.floor(diffMs / (1000 * 60 * 60))
  const diffD = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffH < 1) return 'przed chwilą'
  if (diffH < 24) return `${diffH}h temu`
  if (diffD === 1) return 'wczoraj'
  return `${diffD}d temu`
}

export function NotificationBell({ notifications, unreadCount }: NotificationBellProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Powiadomienia"
        onClick={() => setOpen((prev) => !prev)}
        className="relative grid place-items-center w-[34px] h-[34px] rounded-lg border border-line-strong bg-card text-muted"
      >
        {unreadCount > 0 && (
          <span
            data-testid="unread-badge"
            className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 ring-2 ring-canvas z-10"
          >
            {unreadCount}
          </span>
        )}
        <IconBell className="w-[17px] h-[17px]" />
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] w-[340px] rounded-xl border border-line bg-card shadow-xl z-50">
          <div className="px-4 py-3 border-b border-line">
            <span className="text-[13px] font-semibold">Powiadomienia</span>
          </div>
          <ul className="max-h-[360px] overflow-y-auto divide-y divide-line">
            {notifications.map((n) => (
              <li
                key={n.id}
                className={`flex items-start gap-3 px-4 py-3 text-sm ${n.read ? 'opacity-60' : ''}`}
              >
                <span
                  data-testid="priority-dot"
                  className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${priorityDotClass(n.priority)}`}
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium leading-snug truncate">{n.title}</p>
                  <p className="text-muted text-xs line-clamp-2 mt-0.5">{n.message}</p>
                  <p className="text-muted-2 text-[10px] mt-1 font-mono">{relativeTime(n.createdAt)}</p>
                </div>
              </li>
            ))}
            {notifications.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-muted">Brak powiadomień</li>
            )}
          </ul>
          {unreadCount > 0 && (
            <div className="px-4 py-3 border-t border-line">
              <button
                type="button"
                className="text-xs text-accent-ink font-medium hover:underline"
              >
                Oznacz wszystkie jako przeczytane
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
