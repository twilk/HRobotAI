'use client'

import { useEffect } from 'react'
import FocusTrap from 'focus-trap-react'
import { cn } from '@/lib/cn'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  className?: string
}

export function Modal({ open, onClose, title, children, className }: ModalProps) {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    // Scrim — no role or aria-hidden; aria-modal="true" on the dialog tells AT to ignore outside content
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 backdrop-blur-[2px] p-4"
    >
      <FocusTrap
        focusTrapOptions={{
          returnFocusOnDeactivate: true,
          allowOutsideClick: true,
          fallbackFocus: '[role="dialog"]',
        }}
      >
        {/* Dialog card — role/aria here, not on the scrim */}
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'relative w-full rounded-lg border border-line bg-card p-[22px] shadow-xl',
            className
          )}
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2
              id="modal-title"
              className="font-display text-[17px] font-bold tracking-tightish text-navy"
            >
              {title}
            </h2>
            <button
              onClick={onClose}
              aria-label="Zamknij"
              className="grid h-8 w-8 place-items-center rounded-sm text-muted hover:bg-card-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              ✕
            </button>
          </div>
          {children}
        </div>
      </FocusTrap>
    </div>
  )
}
