import { cn } from '@/lib/cn'

/** Precise "node" glyph: rounded navy square + centered teal dot. */
export function BrandMark({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn(
        'grid place-items-center rounded-lg border border-accent-navy/35 bg-gradient-to-b from-navy-700 to-navy',
        'shadow-[inset_0_0_0_1px_rgb(255_255_255/0.04)]',
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span
        className="grid place-items-center rounded-[4px] border-[1.8px] border-accent-navy"
        style={{ width: size * 0.47, height: size * 0.47 }}
      >
        <span className="rounded-full bg-accent-navy" style={{ width: size * 0.13, height: size * 0.13 }} />
      </span>
    </span>
  )
}

/** HRobot wordmark. tone="navy" for dark backgrounds, "light" for light. */
export function Wordmark({
  tone = 'navy',
  className,
}: {
  tone?: 'navy' | 'light'
  className?: string
}) {
  return (
    <span className={cn('font-display font-extrabold tracking-tightish', tone === 'light' ? 'text-navy' : 'text-white', className)}>
      HRobot<span className={tone === 'light' ? 'text-accent-ink' : 'text-accent-navy'}>.ai</span>
    </span>
  )
}
