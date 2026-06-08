import type { Notification, NotificationPriority } from '@/lib/notifications'

export interface ActivityFeedProps {
  notifications: Notification[]
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
  return `${diffD} dni temu`
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + '…'
}

export function ActivityFeed({ notifications }: ActivityFeedProps) {
  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <h2 className="font-semibold text-[14px] mb-3">Ostatnia aktywność</h2>

      {notifications.length === 0 ? (
        <p className="text-sm text-muted py-4 text-center">Brak aktywności</p>
      ) : (
        <ul className="divide-y divide-line">
          {notifications.map((n) => (
            <li key={n.id} className="flex items-start gap-3 py-2.5">
              <span
                data-testid="activity-priority-dot"
                className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${priorityDotClass(n.priority)}`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="font-medium text-[13px] leading-snug truncate">{n.title}</p>
                  {!n.read && (
                    <span
                      data-testid="unread-dot"
                      className="w-1.5 h-1.5 rounded-full bg-accent-ink shrink-0"
                    />
                  )}
                </div>
                <p className="text-muted text-xs mt-0.5">{truncate(n.message, 60)}</p>
                <p className="text-muted-2 text-[10px] mt-1 font-mono">{relativeTime(n.createdAt)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
