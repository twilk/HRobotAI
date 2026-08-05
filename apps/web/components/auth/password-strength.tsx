'use client'

import { useId, useMemo, useState } from 'react'
import { Field, Input } from '@/components/ui/input'
import { cn } from '@/lib/cn'

const LABELS = ['Za słabe', 'Słabe', 'Dobre', 'Silne']

/**
 * Password field with a 3-segment strength bar.
 * Demo heuristic — in production replace `estimate` with zxcvbn (score 0-4).
 */
export function PasswordField({ name = 'password' }: { name?: string }) {
  const id = useId()
  const [val, setVal] = useState('')
  const score = useMemo(() => estimate(val), [val])
  const filled = Math.min(score, 3)

  return (
    <Field label="Hasło" htmlFor={id}>
      <Input id={id} name={name} type="password" value={val} onChange={(e) => setVal(e.target.value)} autoComplete="new-password" />
      <div className="flex gap-1.5 mt-[9px]" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className={cn('h-1 flex-1 rounded', i < filled ? barColor(filled) : 'bg-line')} />
        ))}
      </div>
      <div className="flex justify-between mt-[7px] text-[11.5px] text-muted">
        <span>Siła hasła</span>
        <span className={cn('font-medium', val ? strengthText(filled) : '')}>{val ? LABELS[filled] : '—'}</span>
      </div>
    </Field>
  )
}

function estimate(v: string): number {
  if (!v) return 0
  let s = 0
  if (v.length >= 8) s++
  if (v.length >= 12) s++
  if (/[A-Z]/.test(v) && /[a-z]/.test(v) && /\d/.test(v)) s++
  if (/[^A-Za-z0-9]/.test(v)) s++
  return Math.min(s, 4)
}
function barColor(f: number): string {
  return f <= 1 ? 'bg-error' : f === 2 ? 'bg-warn' : 'bg-verified'
}
function strengthText(f: number): string {
  return f <= 1 ? 'text-error' : f === 2 ? 'text-warn' : 'text-verified'
}
