'use client'

import { useEffect, useState } from 'react'
import { SidebarNav, type SidebarNavProps } from './sidebar-nav'
import { IconMenu, IconClose } from '@/components/icons'

/** Mobile hamburger + slide-in navy drawer. Only this part of the shell is client-side. */
export function MobileNav(props: SidebarNavProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Otwórz menu"
        aria-expanded={open}
        className="md:hidden grid place-items-center w-[38px] h-[38px] rounded-lg border border-line-strong bg-card text-ink"
      >
        <IconMenu className="w-[18px] h-[18px]" strokeWidth={1.8} />
      </button>

      {open ? (
        <div className="md:hidden fixed inset-0 z-30">
          <button
            type="button"
            aria-label="Zamknij menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-[rgb(8_16_28/0.55)]"
          />
          <aside className="absolute inset-y-0 left-0 w-[286px] flex flex-col bg-navy text-nav-text shadow-2xl">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Zamknij menu"
              autoFocus
              className="absolute top-[18px] right-4 z-10 grid place-items-center w-[30px] h-[30px] rounded-md border border-white/10 text-nav-text"
            >
              <IconClose className="w-[15px] h-[15px]" strokeWidth={2} />
            </button>
            <SidebarNav {...props} />
          </aside>
        </div>
      ) : null}
    </>
  )
}
