import type { ComponentType, ReactNode, SVGProps } from 'react'

/** Onboarding-grade empty state: icon tile + heading + body + actions. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  actions,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>
  title: string
  children?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="max-w-[440px] mx-auto mt-[6vh] text-center">
      <div className="grid place-items-center w-16 h-16 rounded-2xl border border-line bg-card mx-auto mb-5 shadow-sm">
        <Icon className="w-[30px] h-[30px] text-accent-ink" strokeWidth={1.5} />
      </div>
      <h2 className="font-display font-bold text-[21px] tracking-tightish text-navy">{title}</h2>
      {children ? <p className="text-muted text-[14.5px] mt-2.5 mb-[22px] max-w-[38ch] mx-auto leading-relaxed">{children}</p> : null}
      {actions ? <div className="flex gap-2.5 justify-center">{actions}</div> : null}
    </div>
  )
}
