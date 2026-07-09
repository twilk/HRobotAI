import type { SVGProps } from 'react'

// Grafik-local line icons, matching components/icons.tsx (24×24, currentColor stroke). Kept local
// so this module owns its icons without touching the shared set (M2-D2 edits that file in parallel).

type IconProps = SVGProps<SVGSVGElement>

function Icon({ children, strokeWidth = 1.6, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

export const IconChevronLeft = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Icon>
)

export const IconChevronRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 5l7 7-7 7" />
  </Icon>
)

/** "Generuj grafik" — a small machine/automation glyph (sparkle wand). */
export const IconWand = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 20l9-9M13.5 6.5l3 3" />
    <path d="M17 3l.7 1.8L19.5 5.5l-1.8.7L17 8l-.7-1.8L14.5 5.5l1.8-.7z" />
  </Icon>
)

export const IconTrash = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12" />
    <path d="M10 11v6M14 11v6" />
  </Icon>
)

export const IconPencil = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 20h4L18.5 9.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16v4z" />
    <path d="M13.5 6.5l4 4" />
  </Icon>
)

export const IconAlert = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5 21 19H3z" />
    <path d="M12 10v4M12 16.5v.5" />
  </Icon>
)

export const IconSpinner = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3a9 9 0 1 0 9 9" />
  </Icon>
)
