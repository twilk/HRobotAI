import './globals.css'
import type { ReactNode } from 'react'
import { fontVars } from './fonts'

// These strings are the product's public identity: browser tab, bookmark, and every screenshot that
// goes into the milestone evidence pack. They previously still described the design-system preview
// this app grew out of ("System projektowy" / "Runnable reference app for the HRobot design system"),
// so the delivered product introduced itself to the customer as a reference app.
export const metadata = {
  title: 'HRobot · System kadrowy',
  description:
    'HRobot — system kadrowy z grafikiem, wnioskami i asystentem AI. Dane pracowników przetwarzane zgodnie z RODO.',
}

/**
 * FONTS ARE SELF-HOSTED. This layout used to pull three stylesheets from api.fontshare.com and
 * fonts.googleapis.com at runtime, which means every employee's browser announced its IP address to
 * Fontshare and to Google on every page load — in a product whose first selling point is RODO
 * compliance, holding Polish employees' personal data. Google Fonts specifically has EU case law
 * against it (LG München I, 3 O 17493/20).
 *
 * The fix was already written and simply not wired: `app/fonts.ts` declares the same three faces
 * through next/font, whose whole job is to serve them from our own origin. `next/font/local` reads
 * the woff2 files committed under `app/fonts/` (116 kB, five faces); `next/font/google` downloads
 * IBM Plex Mono AT BUILD TIME and emits it from our origin too — no browser ever reaches Google.
 *
 * `fontVars` is a className (the three next/font `.variable` classes), not a style object: next/font
 * generates hashed family names per build, so hardcoding `'Cabinet Grotesk'` in a CSS variable — as
 * this file previously did — would name a family the browser could only resolve via the CDN link.
 * tailwind.config.ts maps `--font-display` / `--font-sans` / `--font-mono` onto the type scale.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pl" className={fontVars}>
      <body>{children}</body>
    </html>
  )
}
