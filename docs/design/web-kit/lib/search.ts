// Global search across employees, leave requests, and notifications.

import { getEmployees } from '@/lib/employees'
import { getLeaveRequests, LEAVE_TYPE_LABELS } from '@/lib/wnioski'
import { getNotifications } from '@/lib/notifications'

export interface SearchResult {
  type: 'employee' | 'leave-request' | 'notification'
  id: string
  title: string
  subtitle: string
  href: string
  score: number
}

/**
 * Scores how well `haystack` matches `query`.
 * Exact match → 1.0, starts-with → 0.7, contains → 0.5, no match → 0.
 */
function scoreMatch(haystack: string, query: string): number {
  const h = haystack.toLowerCase()
  const q = query.toLowerCase()
  if (h === q) return 1.0
  if (h.startsWith(q)) return 0.7
  if (h.includes(q)) return 0.5
  return 0
}

/** Returns the max score across multiple fields. */
function maxScore(fields: string[], query: string): number {
  return Math.max(0, ...fields.map((f) => scoreMatch(f, query)))
}

/**
 * Searches employees, leave requests, and notifications.
 * Returns top 10 results sorted by score descending.
 * Returns [] if query is empty or shorter than 2 non-whitespace chars.
 */
export function globalSearch(query: string): SearchResult[] {
  const q = query.trim()
  if (q.length < 2) return []

  const results: SearchResult[] = []

  // --- Employees ---
  for (const emp of getEmployees()) {
    const fullName = `${emp.firstName} ${emp.lastName}`
    const score = maxScore([fullName, emp.firstName, emp.lastName, emp.position, emp.unit], q)
    if (score > 0) {
      results.push({
        type: 'employee',
        id: emp.id,
        title: fullName,
        subtitle: `${emp.position} · ${emp.unit}`,
        href: `/pracownicy/${emp.id}`,
        score,
      })
    }
  }

  // --- Leave requests ---
  for (const req of getLeaveRequests()) {
    const typeLabel = LEAVE_TYPE_LABELS[req.type]
    const score = maxScore([req.employeeName, typeLabel, req.type], q)
    if (score > 0) {
      results.push({
        type: 'leave-request',
        id: req.id,
        title: req.employeeName,
        subtitle: `${typeLabel} · ${req.status}`,
        href: '/wnioski',
        score,
      })
    }
  }

  // --- Notifications ---
  for (const notif of getNotifications()) {
    const score = maxScore([notif.title, notif.message], q)
    if (score > 0) {
      results.push({
        type: 'notification',
        id: notif.id,
        title: notif.title,
        subtitle: notif.message.slice(0, 60),
        href: notif.actionUrl ?? '/dashboard',
        score,
      })
    }
  }

  // Sort by score descending, then take top 10
  return results.sort((a, b) => b.score - a.score).slice(0, 10)
}
