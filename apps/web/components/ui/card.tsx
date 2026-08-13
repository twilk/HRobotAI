import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

/** Warm surface + hairline border + restrained elevation. No glass. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('bg-card border border-line rounded-lg shadow-sm', className)} {...props} />
}
