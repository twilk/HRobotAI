import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { IconLock } from '@/components/icons'

/** Reusable RODO / encryption trust marker. */
export function SecuredChip({ children = 'Sesja szyfrowana', className }: { children?: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[7px] rounded-full border px-[11px] py-1.5 font-mono text-[11px] font-medium',
        'bg-verified/[0.08] border-verified/25 text-[#247F56]',
        className,
      )}
    >
      <IconLock className="w-[13px] h-[13px]" strokeWidth={1.8} />
      {children}
    </span>
  )
}
