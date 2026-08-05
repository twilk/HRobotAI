import type { InputHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  valid?: boolean
  invalid?: boolean
}

/** Label-above field wrapper (never placeholder-as-label). */
export function Field({
  label,
  htmlFor,
  children,
  hint,
  className,
}: {
  label: string
  htmlFor: string
  children: ReactNode
  hint?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-4', className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-ink mb-[7px]">
        {label}
      </label>
      {children}
      {hint ? <div className="text-xs text-muted mt-1.5">{hint}</div> : null}
    </div>
  )
}

export function Input({ className, valid, invalid, ...props }: InputProps) {
  return (
    <input
      className={cn(
        'w-full h-11 px-[13px] rounded-sm border border-line-strong bg-card text-[14.5px] text-ink',
        'placeholder:text-muted-2 transition-[border-color,box-shadow] focus:outline-none focus:border-accent',
        valid && 'border-verified focus:border-verified',
        invalid && 'border-error focus:border-error',
        className,
      )}
      {...props}
    />
  )
}
