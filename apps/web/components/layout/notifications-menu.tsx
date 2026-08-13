'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { IconBell, IconRequests, IconCheck } from '@/components/icons'

/** A single actionable summary row surfaced in the bell dropdown. */
export interface Notif {
  key: string
  count: number
  title: string
  href: string
}

/**
 * Build the notification summary from live counts. Pure + exported so the aggregation is unit-tested:
 * only groups with count > 0 surface, so the bell reflects REAL pending work (fixes the always-on
 * decorative dot). Each row deep-links to the screen that resolves it.
 */
export function buildNotifs(counts: { pendingWnioski: number; pendingSwaps: number }): Notif[] {
  const rows: Notif[] = [
    { key: 'wnioski', count: counts.pendingWnioski, title: 'wniosków oczekuje na decyzję', href: '/wnioski' },
    { key: 'zamiany', count: counts.pendingSwaps, title: 'zamian do zatwierdzenia', href: '/zamiany' },
  ]
  return rows.filter((r) => r.count > 0)
}

/** Count rows returned by a same-origin proxy list endpoint; null (→ 0) when unavailable for the role. */
async function countOf(url: string): Promise<number> {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return 0
    const rows = (await res.json()) as unknown
    return Array.isArray(rows) ? rows.length : 0
  } catch {
    return 0
  }
}

/**
 * Topbar bell → dropdown of live "needs your attention" items (pending leave requests + shift swaps
 * awaiting a manager decision). Fixes the dead bell (was a <button> with no handler and an always-on
 * red dot): the dot now lights only when there is real pending work, and the panel links straight to
 * the resolving screen. Each fetch degrades to 0 for roles that can't see it (best-effort, like KPIs).
 */
export function NotificationsMenu() {
  const [open, setOpen] = useState(false)
  const [notifs, setNotifs] = useState<Notif[]>([])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [pendingWnioski, pendingSwaps] = await Promise.all([
        countOf('/api/wnioski?state=PENDING'),
        countOf('/api/shift-swap?state=PENDING_MANAGER'),
      ])
      if (!cancelled) setNotifs(buildNotifs({ pendingWnioski, pendingSwaps }))
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClick)
    }
  }, [open])

  const total = notifs.reduce((n, r) => n + r.count, 0)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={total > 0 ? `Powiadomienia (${total})` : 'Powiadomienia'}
        className="relative grid place-items-center w-[34px] h-[34px] rounded-lg border border-line-strong bg-card text-muted hover:text-ink transition-colors"
      >
        {total > 0 ? (
          <span className="absolute top-[7px] right-2 w-1.5 h-1.5 rounded-full bg-accent ring-2 ring-card" />
        ) : null}
        <IconBell className="w-[17px] h-[17px]" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-line-strong bg-card shadow-xl overflow-hidden z-20"
        >
          <div className="px-3.5 py-2.5 border-b border-line text-[11px] font-mono uppercase tracking-[.08em] text-muted-2">
            Powiadomienia
          </div>
          {notifs.length === 0 ? (
            <div className="flex items-center gap-2.5 px-3.5 py-4 text-[13px] text-muted">
              <IconCheck className="w-[16px] h-[16px] text-verified" />
              Brak nowych powiadomień
            </div>
          ) : (
            notifs.map((n) => (
              <Link
                key={n.key}
                href={n.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-3.5 py-2.5 text-[13px] text-ink hover:bg-canvas transition-colors"
              >
                <span className="grid place-items-center w-7 h-7 rounded-lg bg-accent/10 text-accent-ink shrink-0">
                  <IconRequests className="w-[15px] h-[15px]" />
                </span>
                <span>
                  <b className="tabular-nums">{n.count}</b> {n.title}
                </span>
              </Link>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
