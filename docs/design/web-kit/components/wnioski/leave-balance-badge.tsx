'use client'

import { cn } from '@/lib/cn'

interface LeaveBalanceBadgeProps {
  remaining: number
  leaveType: string
  label?: string
}

type Tone = 'green' | 'amber' | 'red'

function getTone(remaining: number): Tone {
  if (remaining > 7) return 'green'
  if (remaining >= 3) return 'amber'
  return 'red'
}

const toneClasses: Record<Tone, string> = {
  green: 'text-verified border-verified/30 bg-verified/[0.08]',
  amber: 'text-warn border-warn/30 bg-warn/[0.08]',
  red: 'text-destructive border-destructive/30 bg-destructive/[0.08]',
}

export function LeaveBalanceBadge({ remaining, leaveType: _leaveType, label }: LeaveBalanceBadgeProps) {
  const tone = getTone(remaining)

  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      {label && <span className="text-muted">{label}:</span>}
      <span
        data-tone={tone}
        className={cn(
          'inline-flex items-center font-mono text-[9.5px] tracking-[.08em] uppercase px-2 py-0.5 rounded-full border whitespace-nowrap',
          toneClasses[tone],
        )}
      >
        {remaining} dni
      </span>
    </span>
  )
}
