import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

/** Hairline data table: mono uppercase headers, row hover, no last-row border. */
export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cn(
        'w-full border-separate border-spacing-0 bg-card border border-line rounded-lg overflow-hidden',
        '[&_tbody_tr:last-child_td]:border-b-0 [&_tbody_tr:hover]:bg-card-2',
        className,
      )}
      {...props}
    />
  )
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'text-left font-mono text-[10.5px] tracking-[.08em] uppercase text-muted-2 px-4 py-[13px] bg-card-2 border-b border-line',
        className,
      )}
      {...props}
    />
  )
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-4 py-[13px] border-b border-line text-sm align-middle', className)} {...props} />
}
