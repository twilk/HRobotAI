'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { IconUser, IconLogout } from '@/components/icons'
import { logout } from '@/lib/auth-actions'

export interface UserMenuProps {
  name: string
  role: string
  initials: string
}

/**
 * Topbar avatar → dropdown. Fixes the dead profile icon (was a plain <span> with no behaviour): the
 * avatar is now a real button opening a menu with "Mój profil" (→ /profil) and "Wyloguj". Client-only
 * (like mobile-drawer) so the rest of the shell stays a Server Component. Closes on Escape / outside
 * click; logout stays a real server-action form so the httpOnly cookies are cleared server-side.
 */
export function UserMenu({ name, role, initials }: UserMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menu konta"
        className="flex items-center gap-2.5 pl-1.5 rounded-lg hover:bg-card transition-colors"
      >
        <span className="grid place-items-center w-[34px] h-[34px] rounded-[9px] bg-gradient-to-b from-navy-700 to-navy text-white font-semibold text-[13px]">
          {initials}
        </span>
        <span className="hidden sm:block text-left">
          <span className="block text-[13px] font-medium leading-tight">{name}</span>
          <span className="block font-mono text-[9.5px] tracking-[.08em] uppercase text-accent-ink mt-0.5">
            {role}
          </span>
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-60 rounded-xl border border-line-strong bg-card shadow-xl overflow-hidden z-20"
        >
          <div className="flex items-center gap-2.5 px-3.5 py-3 border-b border-line">
            <span className="grid place-items-center w-9 h-9 rounded-[9px] bg-gradient-to-b from-navy-700 to-navy text-white font-semibold text-[13px]">
              {initials}
            </span>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold leading-tight truncate">{name}</div>
              <div className="font-mono text-[9.5px] tracking-[.08em] uppercase text-accent-ink mt-0.5">
                {role}
              </div>
            </div>
          </div>
          <Link
            href="/profil"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-ink hover:bg-canvas transition-colors"
          >
            <IconUser className="w-[16px] h-[16px] text-muted" />
            Mój profil
          </Link>
          <form action={logout} className="border-t border-line">
            <button
              type="submit"
              role="menuitem"
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-ink hover:bg-canvas hover:text-error transition-colors"
            >
              <IconLogout className="w-[16px] h-[16px] text-muted" />
              Wyloguj się
            </button>
          </form>
        </div>
      ) : null}
    </div>
  )
}
