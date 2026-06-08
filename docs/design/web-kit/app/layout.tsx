import './globals.css'
import type { ReactNode, CSSProperties } from 'react'
import { Toaster } from 'react-hot-toast'

export const metadata = {
  title: 'HRobot · System projektowy',
  description: 'Runnable reference app for the HRobot design system.',
}

// Preview app loads the Fontshare + Google fonts via CDN and maps them to the
// token CSS variables. (Production self-hosts via app/fonts.ts + next/font.)
const fontVars = {
  '--font-display': "'Cabinet Grotesk', system-ui, sans-serif",
  '--font-sans': "'General Sans', system-ui, sans-serif",
  '--font-mono': "'IBM Plex Mono', ui-monospace, monospace",
} as unknown as CSSProperties

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pl" style={fontVars}>
      <body>
        {/* TODO(Phase1B-T2): Migrate fonts from CDN to next/font/local for GDPR compliance.
            Cabinet Grotesk + General Sans: download woff2 from api.fontshare.com to public/fonts/.
            IBM Plex Mono: replace CDN with next/font/google({ subsets: ['latin'] }). */}
        {/* React 19 hoists these <link> tags into <head>. */}
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@800,700&f[]=general-sans@400,500,600&display=swap"
        />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap" />
        {children}
        <Toaster position="top-right" />
      </body>
    </html>
  )
}
