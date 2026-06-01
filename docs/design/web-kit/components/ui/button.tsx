import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'ghost'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

const base =
  'inline-flex items-center justify-center gap-2 h-[42px] px-[18px] rounded-sm text-[14.5px] font-semibold whitespace-nowrap border transition-[transform,background-color,box-shadow] duration-150 disabled:opacity-50 disabled:cursor-not-allowed'

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-white border-transparent hover:bg-accent-ink active:translate-y-px',
  ghost: 'bg-transparent text-ink border-line-strong hover:bg-card-2',
}

export function Button({ variant = 'primary', className, ...props }: ButtonProps) {
  return <button className={cn(base, variants[variant], className)} {...props} />
}
