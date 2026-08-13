import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

type Tone = 'default' | 'role' | 'ok' | 'warn' | 'muted'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

const tones: Record<Tone, string> = {
  default: 'text-muted border-line-strong',
  role: 'text-accent-ink border-accent/30 bg-accent/[0.06]',
  ok: 'text-verified border-verified/30 bg-verified/[0.08]',
  warn: 'text-warn border-warn/30 bg-warn/[0.08]',
  muted: 'text-muted border-line-strong bg-card-2',
}

export function Badge({ tone = 'default', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-mono text-[9.5px] tracking-[.08em] uppercase px-2 py-0.5 rounded-full border whitespace-nowrap',
        tones[tone],
        className,
      )}
      {...props}
    />
  )
}
