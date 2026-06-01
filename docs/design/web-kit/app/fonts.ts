// Module-level font setup (next/font self-hosts → no layout shift, no CDN dependency).
// Display + UI faces are from Fontshare (free, ITF license). Download the woff2 files
// into app/fonts/ (see web-kit README) — next/font/local handles the rest.
import localFont from 'next/font/local'
import { IBM_Plex_Mono } from 'next/font/google'

// Display — Cabinet Grotesk (700, 800)
export const fontDisplay = localFont({
  src: [
    { path: './fonts/CabinetGrotesk-Bold.woff2', weight: '700', style: 'normal' },
    { path: './fonts/CabinetGrotesk-Extrabold.woff2', weight: '800', style: 'normal' },
  ],
  variable: '--font-display',
  display: 'swap',
  fallback: ['system-ui', 'sans-serif'],
})

// UI / body — General Sans (400, 500, 600)
export const fontSans = localFont({
  src: [
    { path: './fonts/GeneralSans-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/GeneralSans-Medium.woff2', weight: '500', style: 'normal' },
    { path: './fonts/GeneralSans-Semibold.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-sans',
  display: 'swap',
  fallback: ['system-ui', 'sans-serif'],
})

// Machine / security layer — IBM Plex Mono (on Google Fonts; latin-ext covers Polish)
export const fontMono = IBM_Plex_Mono({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
})

/** Spread on <html> in the root layout: className={fontVars}. */
export const fontVars = `${fontDisplay.variable} ${fontSans.variable} ${fontMono.variable}`
