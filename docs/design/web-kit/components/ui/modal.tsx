'use client'

import { type ReactNode, useEffect } from 'react'
import { cn } from '@/lib/cn'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  className?: string
}

/**
 * Modal: warm card on navy scrim. No glass. Escape closes.
 * Per screens-and-components.md §E component kit.
 */
export function Modal({ open, onClose, title, children, className }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(8,16,28,.55)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={cn(
          'w-full max-w-[440px] rounded-lg border border-line bg-card p-6 shadow-lift',
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-[19px] font-bold tracking-tightish text-navy mb-4">
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}
