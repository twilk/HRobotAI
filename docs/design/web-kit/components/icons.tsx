import type { SVGProps } from 'react'

// Decorative line icons. Size + color via className (w-*, h-*, text-*).
// Authored once, hoisted; stroke = currentColor so they inherit text color.

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

export const IconDashboard = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </Icon>
)
export const IconUsers = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 20c.7-3.3 3-5 5.5-5s4.8 1.7 5.5 5" />
    <path d="M16 6.5a3 3 0 0 1 0 5.6" />
    <path d="M18.5 20c-.3-2-1-3.3-2-4.2" />
  </Icon>
)
export const IconCalendar = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4" />
  </Icon>
)
export const IconRequests = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 3.5h11l3 3V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
    <path d="M8 11h8M8 15h5" />
  </Icon>
)
export const IconKey = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="13" r="3.4" />
    <path d="M11 11.5 19 4M16 4h3v3M14.5 6.5 16.5 8.5" />
  </Icon>
)
export const IconSettings = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18 6l-2 2M8 16l-2 2M18 18l-2-2M8 8 6 6" />
  </Icon>
)
export const IconUser = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="8" r="3.4" />
    <path d="M5 20c.8-3.6 3.4-5.5 7-5.5s6.2 1.9 7 5.5" />
  </Icon>
)
export const IconShield = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 2.5 4.5 6v6c0 4.6 3.1 7.9 7.5 9.5 4.4-1.6 7.5-4.9 7.5-9.5V6L12 2.5Z" />
  </Icon>
)
export const IconShieldCheck = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 2.5 4.5 6v6c0 4.6 3.1 7.9 7.5 9.5 4.4-1.6 7.5-4.9 7.5-9.5V6L12 2.5Z" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
)
export const IconLock = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Icon>
)
export const IconBell = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
    <path d="M10 19a2 2 0 0 0 4 0" />
  </Icon>
)
export const IconCheck = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 12 4 4 10-10" />
  </Icon>
)
export const IconArrowRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
)
export const IconPlus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)
export const IconUserPlus = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 20c.7-3.3 3-5 5.5-5 1 0 1.9.2 2.7.6" />
    <path d="M18 13v6M15 16h6" />
  </Icon>
)
export const IconMail = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
    <path d="m4 7 8 6 8-6" />
  </Icon>
)
export const IconSearch = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.2-3.2" />
  </Icon>
)
export const IconClose = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
)
export const IconMenu = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
)
export const IconGlobe = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18" />
  </Icon>
)
export const IconEye = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 12S6 5.6 12 5.6 21.5 12 21.5 12 18 18.4 12 18.4 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.8" />
  </Icon>
)
export const IconEdit = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14.5 5.5l4 4M4 20l1-4L16.5 4.5a1.5 1.5 0 0 1 2 0l1 1a1.5 1.5 0 0 1 0 2L8 19Z" />
  </Icon>
)
export const IconChevronLeft = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 6l-6 6 6 6" />
  </Icon>
)
export const IconChevronDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 9l6 6 6-6" />
  </Icon>
)
export const IconFileText = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 3v5h5" />
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    <path d="M8 13h6M8 16h4" />
  </Icon>
)
export const IconPhone = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.5 3h3l1.5 4-2 1.3a11 11 0 0 0 4.7 4.7L16 14l4 1.5v3a2 2 0 0 1-2.1 2A16 16 0 0 1 4 5.1 2 2 0 0 1 6.5 3Z" />
  </Icon>
)
